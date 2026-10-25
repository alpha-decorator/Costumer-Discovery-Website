"""Speech to text with Sarvam AI's batch API (a cloud service).

The audio file is uploaded to Sarvam, so this runs only when a key is set (SARVAM_API_KEY) and ASR_BACKEND allows it. The flow is
Sarvam's own: create a job, upload the file to a signed link, start, poll until done, then download the JSON with the transcript.
Only the standard library is used, like the Ollama client.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

from .asr import Cancelled

DEFAULT_BASE = "https://api.sarvam.ai"
# The website's language choice -> Sarvam's BCP-47 code. "unknown" lets Sarvam detect the language.
LANGUAGE_CODES = {"hi": "hi-IN", "en": "en-IN", "auto": "unknown"}


class SarvamError(Exception):
    pass


class SarvamClient:
    def __init__(self, api_key: str, model: str = "saaras:v4", base: str = DEFAULT_BASE, poll_seconds: float = 5.0,
                 timeout_seconds: float = 1800.0):
        self.api_key = api_key
        self.model = model
        self.base = base.rstrip("/")
        self.poll_seconds = poll_seconds
        self.timeout_seconds = timeout_seconds

    # ------------------------------------------------------------------ plumbing
    def _request(self, method: str, url: str, body: bytes | None = None, headers: dict | None = None) -> bytes:
        request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise SarvamError("Sarvam's quota is used up or the rate limit was hit (429).") from error
            if error.code in {401, 403}:
                raise SarvamError("Sarvam rejected the API key.") from error
            detail = error.read(300).decode("utf-8", "replace").strip()
            raise SarvamError(f"Sarvam answered {error.code} for {url.rsplit('/', 1)[-1]}: {detail}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise SarvamError(f"Could not reach Sarvam: {error}") from error

    def _json(self, method: str, path: str, payload: dict | None = None) -> dict:
        headers = {"api-subscription-key": self.api_key}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["content-type"] = "application/json"
        raw = self._request(method, f"{self.base}{path}", body, headers)
        try:
            reply = json.loads(raw or b"{}")
        except ValueError as error:
            raise SarvamError("Sarvam sent an unreadable reply.") from error
        if not isinstance(reply, dict):
            raise SarvamError("Sarvam sent an unexpected reply.")
        return reply

    # ------------------------------------------------------------------ the batch job
    def transcribe_file(self, path: str | Path, language: str, progress: Callable[[str, float, str], None] | None = None,
                        cancelled: Callable[[], bool] = lambda: False) -> dict:
        """Returns Sarvam's answer for the file: at least `transcript`, and `language_code` when known."""
        path = Path(path)
        report = progress or (lambda stage, fraction, message: None)
        report("uploading", 0.0, "Sarvam AI")
        code = LANGUAGE_CODES.get(language, "unknown")
        job = self._json("POST", "/speech-to-text/job/v1", {"job_parameters": {"language_code": code, "model": self.model}})
        job_id = job.get("job_id")
        if not job_id:
            raise SarvamError("Sarvam did not return a job id.")
        name = f"input{path.suffix.lower() or '.audio'}"
        links = self._json("POST", "/speech-to-text/job/v1/upload-files", {"job_id": job_id, "files": [name]})
        upload_url = (links.get("upload_urls") or {}).get(name, {}).get("file_url")
        if not upload_url:
            raise SarvamError("Sarvam did not return an upload link.")
        self._request("PUT", upload_url, path.read_bytes(), {"content-type": "application/octet-stream"})
        self._json("POST", f"/speech-to-text/job/v1/{job_id}/start")
        outputs = self._wait(job_id, report, cancelled)
        links = self._json("POST", "/speech-to-text/job/v1/download-files", {"job_id": job_id, "files": outputs})
        download_url = (links.get("download_urls") or {}).get(outputs[0], {}).get("file_url")
        if not download_url:
            raise SarvamError("Sarvam did not return a download link.")
        report("transcribing", 1.0, "Sarvam AI")
        try:
            result = json.loads(self._request("GET", download_url) or b"{}")
        except ValueError as error:
            raise SarvamError("Sarvam's transcript file could not be read.") from error
        if not isinstance(result, dict) or not str(result.get("transcript", "")).strip():
            raise SarvamError("Sarvam returned no transcript for this recording.")
        return result

    def _wait(self, job_id: str, report, cancelled) -> list[str]:
        """Polls until the job completes; returns the output file names to download."""
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            if cancelled():
                raise Cancelled()
            status = self._json("GET", f"/speech-to-text/job/v1/{job_id}/status")
            state = str(status.get("job_state", ""))
            if state == "Completed":
                names = [output.get("file_name") for detail in status.get("job_details") or [] for output in detail.get("outputs") or []]
                names = [name for name in names if name]
                if not names:
                    raise SarvamError("Sarvam finished the job without any output file.")
                return names
            if state == "Failed":
                raise SarvamError("Sarvam could not process this recording.")
            if time.monotonic() > deadline:
                raise SarvamError("Sarvam took too long to finish this recording.")
            report("transcribing", 0.5, state or "waiting")
            time.sleep(self.poll_seconds)
