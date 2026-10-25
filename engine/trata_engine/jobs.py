"""One background worker runs jobs one at a time (the models already use every CPU core, so parallel jobs would only slow each other down).

Finished results are saved to disk. If the browser tab is closed halfway through a 500-file batch, adding the same files again
returns the saved results instantly instead of redoing them (jobs are matched by a client-supplied key).
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from .asr import AsrError, Cancelled
from .audio import AudioError
from .llm import LlmError

KEEP_DAYS = 7
RESULT_VERSION = 6   # bump when the shape or limits of a result change: older saved results are then recomputed instead of reused


@dataclass
class Job:
    id: str
    kind: str                       # "audio" | "text"
    client_key: str = ""
    filename: str = ""
    language: str = "auto"
    path: str | None = None
    text: str | None = None
    analyze: bool = True            # False: speech to text only (the website reads the transcript with its own rules)
    status: str = "queued"          # queued | running | done | error | cancelled
    stage: str = "queued"
    progress: float = 0.0
    message: str = ""
    result: dict | None = None
    error: str | None = None
    created: float = field(default_factory=time.time)
    started: float | None = None
    finished: float | None = None
    cancel: threading.Event = field(default_factory=threading.Event, repr=False)

    def public(self, position: int = 0) -> dict:
        body = {"id": self.id, "kind": self.kind, "filename": self.filename, "status": self.status, "stage": self.stage,
                "progress": round(self.progress, 4), "message": self.message, "queuePosition": position,
                "elapsedSec": round((self.finished or time.time()) - (self.started or self.created), 1)}
        if self.status == "done":
            body["result"] = self.result
        if self.status in {"error", "cancelled"}:
            body["error"] = self.error
        return body


def friendly_error(error: Exception) -> str:
    if isinstance(error, (AsrError, AudioError, LlmError)):
        return str(error)
    return f"Unexpected problem: {type(error).__name__}: {error}"


class JobManager:
    def __init__(self, data_dir: Path, pipeline):
        self.pipeline = pipeline
        self.dir = Path(data_dir) / "jobs"
        self.uploads = Path(data_dir) / "uploads"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.uploads.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, Job] = {}
        self.order: list[str] = []
        self.queue: queue.Queue[str] = queue.Queue()
        self.lock = threading.Lock()
        self.stop_flag = threading.Event()
        self.worker: threading.Thread | None = None
        self.current: str | None = None
        self._load_saved()

    # -- persistence
    def _load_saved(self) -> None:
        cutoff = time.time() - KEEP_DAYS * 86400
        for file in self.dir.glob("*.json"):
            try:
                if file.stat().st_mtime < cutoff:
                    file.unlink()
                    continue
                data = json.loads(file.read_text(encoding="utf-8"))
                if data.get("resultVersion") != RESULT_VERSION:
                    file.unlink()
                    continue
                job = Job(id=data["id"], kind=data["kind"], client_key=data.get("clientKey", ""), filename=data.get("filename", ""),
                          status=data["status"], stage=data["status"], progress=1.0, result=data.get("result"), error=data.get("error"),
                          created=data.get("created", time.time()), finished=data.get("finished"))
                self.jobs[job.id] = job
            except (OSError, ValueError, KeyError):
                continue
        for file in self.uploads.glob("*"):   # leftovers from a crash
            try:
                file.unlink()
            except OSError:
                pass

    def _save(self, job: Job) -> None:
        data = {"id": job.id, "kind": job.kind, "clientKey": job.client_key, "filename": job.filename, "status": job.status,
                "result": job.result, "error": job.error, "created": job.created, "finished": job.finished, "resultVersion": RESULT_VERSION}
        temporary = self.dir / f"{job.id}.json.tmp"
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, self.dir / f"{job.id}.json")

    # -- public API
    def start(self) -> None:
        self.worker = threading.Thread(target=self._run, name="trata-worker", daemon=True)
        self.worker.start()

    def stop(self) -> None:
        self.stop_flag.set()
        self.queue.put("")

    def find_by_key(self, key: str) -> Job | None:
        if not key:
            return None
        with self.lock:
            for job in reversed(list(self.jobs.values())):
                if job.client_key == key and job.status in {"queued", "running", "done"}:
                    return job
        return None

    def submit(self, kind: str, client_key: str = "", filename: str = "", language: str = "auto", path: str | None = None, text: str | None = None, analyze: bool = True) -> tuple[Job, bool]:
        existing = self.find_by_key(client_key)
        if existing:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            return existing, True
        job = Job(id=uuid.uuid4().hex[:16], kind=kind, client_key=client_key, filename=filename, language=language, path=path, text=text, analyze=analyze)
        with self.lock:
            self.jobs[job.id] = job
            self.order.append(job.id)
        self.queue.put(job.id)
        return job, False

    def get(self, job_id: str) -> dict | None:
        job = self.jobs.get(job_id)
        if not job:
            return None
        with self.lock:
            waiting = [other for other in self.order if self.jobs[other].status == "queued"]
        return job.public(waiting.index(job.id) + 1 if job.id in waiting else 0)

    def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job or job.status in {"done", "error", "cancelled"}:
            return False
        job.cancel.set()
        if job.status == "queued":
            self._finish(job, "cancelled", error="Cancelled.")
        return True

    def counts(self) -> dict:
        with self.lock:
            statuses = [job.status for job in self.jobs.values()]
        return {"queued": statuses.count("queued"), "running": statuses.count("running")}

    # -- worker
    def _finish(self, job: Job, status: str, result: dict | None = None, error: str | None = None) -> None:
        job.status, job.result, job.error, job.finished = status, result, error, time.time()
        job.stage = status
        if status == "done":
            job.progress = 1.0
        if job.path:
            try:
                os.unlink(job.path)
            except OSError:
                pass
            job.path = None
        job.text = None
        if status in {"done", "error"}:
            try:
                self._save(job)
            except OSError:
                pass

    def _run(self) -> None:
        while not self.stop_flag.is_set():
            job_id = self.queue.get()
            if not job_id or self.stop_flag.is_set():
                continue
            job = self.jobs.get(job_id)
            if not job or job.status != "queued":
                continue
            job.status, job.started, self.current = "running", time.time(), job.id

            def progress(stage: str, fraction: float, message: str = "", job=job) -> None:
                job.stage, job.progress, job.message = stage, fraction, message

            try:
                if job.kind == "audio":
                    result = self.pipeline.run_audio(job.path, job.language, progress, job.cancel.is_set, job.analyze)
                else:
                    result = self.pipeline.run_text(job.text or "", job.language, progress, job.cancel.is_set, job.analyze)
                self._finish(job, "done", result=result)
            except Cancelled:
                self._finish(job, "cancelled", error="Cancelled.")
            except Exception as error:  # a failed job must never kill the worker
                self._finish(job, "error", error=friendly_error(error))
            finally:
                self.current = None
