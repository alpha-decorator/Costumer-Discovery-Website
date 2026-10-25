"""A small HTTP server (standard library only). The Next.js website talks to it; browsers are deliberately refused."""
from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import __version__
from .config import Settings
from .jobs import JobManager

JSON_LIMIT = 4 * 1024 * 1024


class EngineServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, settings: Settings, pipeline, manager: JobManager):
        super().__init__((settings.host, settings.port), Handler)
        self.settings = settings
        self.pipeline = pipeline
        self.manager = manager

    def loopback_only(self) -> bool:
        return self.settings.host in {"127.0.0.1", "localhost", "::1"}

    def allowed_hosts(self) -> set[str]:
        port = self.server_address[1]
        return {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}", f"{self.settings.host}:{port}"}


class Handler(BaseHTTPRequestHandler):
    server: EngineServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # keep the console quiet; failures are reported through job status
        return

    # -- helpers
    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if status >= 400:
            self.close_connection = True   # the request body may not have been read; do not reuse this connection
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def _guard(self) -> bool:
        """Browsers always send Origin on cross-site requests; our own Next.js server does not. Refusing them blocks drive-by web pages."""
        if self.headers.get("Origin") is not None:
            self._send(403, {"error": "browser_origin_refused"})
            return False
        if self.server.loopback_only() and self.headers.get("Host", "") not in self.server.allowed_hosts():
            self._send(403, {"error": "bad_host"})
            return False
        token = self.server.settings.token
        if token:
            given = self.headers.get("Authorization", "")
            if not secrets.compare_digest(given.encode(), f"Bearer {token}".encode()):
                self._send(401, {"error": "unauthorized"})
                return False
        return True

    def _read_body(self, limit: int, sink=None) -> bytes | int | None:
        """Read the request body (Content-Length or chunked). Writes to `sink` if given, else returns bytes. None means too large."""
        total, parts = 0, []

        def take(chunk: bytes) -> bool:
            nonlocal total
            total += len(chunk)
            if total > limit:
                return False
            if sink:
                sink.write(chunk)
            else:
                parts.append(chunk)
            return True

        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    while self.rfile.readline().strip():
                        pass
                    break
                remaining = size
                while remaining:
                    block = self.rfile.read(min(remaining, 1 << 20))
                    if not block:
                        return None
                    remaining -= len(block)
                    if not take(block):
                        return None
                self.rfile.readline()
        else:
            remaining = int(self.headers.get("Content-Length") or 0)
            if remaining > limit:
                return None
            while remaining:
                block = self.rfile.read(min(remaining, 1 << 20))
                if not block:
                    break
                remaining -= len(block)
                if not take(block):
                    return None
        return total if sink else b"".join(parts)

    # -- routes
    def do_GET(self) -> None:
        if not self._guard():
            return
        path = urlparse(self.path).path
        if path == "/health":
            status = self.server.pipeline.status()
            self._send(200, {"ok": True, "version": __version__, **status, "jobs": self.server.manager.counts()})
            return
        match = re.fullmatch(r"/jobs/([0-9a-f]{8,32})", path)
        if match:
            job = self.server.manager.get(match.group(1))
            self._send(200, job) if job else self._send(404, {"error": "not_found"})
            return
        self._send(404, {"error": "not_found"})

    def do_DELETE(self) -> None:
        if not self._guard():
            return
        match = re.fullmatch(r"/jobs/([0-9a-f]{8,32})", urlparse(self.path).path)
        if match and self.server.manager.cancel(match.group(1)):
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if not self._guard():
            return
        url = urlparse(self.path)
        if url.path != "/jobs":
            self._send(404, {"error": "not_found"})
            return
        query = {key: values[0] for key, values in parse_qs(url.query).items()}
        language = query.get("language", "auto")
        if language not in {"auto", "hi", "en"}:
            self._send(400, {"error": "bad_language"})
            return
        analyze = query.get("analyze", "1") != "0"
        key = query.get("client_key", "")[:200]
        if key and not analyze:
            key += "|transcript-only"     # a transcript-only result must never be handed back for a full analysis, or the other way round
        manager = self.server.manager
        existing = manager.find_by_key(key)
        kind = query.get("kind", "audio")
        if kind == "text":
            body = self._read_body(JSON_LIMIT)
            if body is None:
                self._send(413, {"error": "too_large"})
                return
            try:
                text = str(json.loads(body.decode("utf-8")).get("text", ""))
            except (ValueError, AttributeError):
                self._send(400, {"error": "bad_json"})
                return
            if not text.strip():
                self._send(400, {"error": "empty_text"})
                return
            job, reused = manager.submit("text", key, "", language, text=text[:200_000], analyze=analyze)
        elif kind == "audio":
            if existing:   # already uploaded or finished: swallow the body without storing it
                self._read_body(self.server.settings.max_upload_mb * 1024 * 1024, sink=_Null())
                self._send(200, {**manager.get(existing.id), "reused": True})
                return
            limit = self.server.settings.max_upload_mb * 1024 * 1024
            # Keep the uploaded file's own extension (m4a, mp3, wav...): cloud speech services detect the format from it.
            extension = Path(query.get("filename", "")).suffix.lower()
            extension = extension if re.fullmatch(r"\.[a-z0-9]{1,5}", extension) else ".audio"
            handle = tempfile.NamedTemporaryFile(dir=manager.uploads, suffix=extension, delete=False)
            try:
                with handle:
                    received = self._read_body(limit, sink=handle)
                if received is None or received == 0:
                    raise ValueError("too_large" if received is None else "empty")
            except (ValueError, OSError) as error:
                try:
                    os.unlink(handle.name)
                except OSError:
                    pass
                self.close_connection = True   # part of the body may be unread
                self._send(413 if str(error) == "too_large" else 400, {"error": str(error) if str(error) in {"too_large", "empty"} else "bad_upload"})
                return
            job, reused = manager.submit("audio", key, query.get("filename", "")[:200], language, path=handle.name, analyze=analyze)
        else:
            self._send(400, {"error": "bad_kind"})
            return
        self._send(200 if reused else 202, {**manager.get(job.id), "reused": reused})


class _Null:
    def write(self, data: bytes) -> None:
        return None


def make_server(settings: Settings, pipeline) -> EngineServer:
    if settings.host not in {"127.0.0.1", "localhost", "::1"} and not settings.token:
        raise SystemExit("ENGINE_HOST is not a loopback address, so ENGINE_TOKEN must be set (anyone on the network could otherwise use the engine).")
    manager = JobManager(settings.data_dir, pipeline)
    server = EngineServer(settings, pipeline, manager)
    manager.start()
    return server


def serve_forever(settings: Settings, pipeline) -> None:
    server = make_server(settings, pipeline)
    print(f"Trata engine {__version__} listening on http://{settings.host}:{settings.port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        server.manager.stop()
        server.server_close()
