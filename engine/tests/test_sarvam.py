import json
import socket
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

import helpers  # noqa: F401  (adds the engine to sys.path)
from trata_engine.asr import AsrEngine
from trata_engine.pipeline import Pipeline
from trata_engine.sarvam import SarvamClient, SarvamError

KEY = "test-key"
TRANSCRIPT = "नमस्ते, मैं Trata के बारे में बात कर रहा हूँ।"


class FakeSarvam:
    """Pretends to be Sarvam's batch API. `state` is what the status call answers; `quota` makes every call answer 429."""

    def __init__(self):
        self.state = "Completed"
        self.quota = False
        self.calls: list[tuple[str, str, bytes]] = []
        self.uploaded = b""
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _body(self):
                length = int(self.headers.get("content-length") or 0)
                return self.rfile.read(length) if length else b""

            def _send(self, code, payload=None, raw=None):
                data = raw if raw is not None else json.dumps(payload or {}).encode("utf-8")
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _route(self, method):
                body = self._body()
                fake.calls.append((method, self.path, body))
                if fake.quota:
                    return self._send(429, {"error": "Quota Exceeded"})
                if self.path.startswith("/put/"):
                    fake.uploaded = body
                    return self._send(200, {})
                if self.path.startswith("/out/"):
                    return self._send(200, {"transcript": TRANSCRIPT, "language_code": "hi-IN"})
                if self.headers.get("api-subscription-key") != KEY:
                    return self._send(401, {"error": "bad key"})
                base = fake.url
                if method == "POST" and self.path == "/speech-to-text/job/v1":
                    return self._send(200, {"job_id": "job-1", "job_state": "Accepted"})
                if method == "POST" and self.path == "/speech-to-text/job/v1/upload-files":
                    name = json.loads(body)["files"][0]
                    return self._send(200, {"upload_urls": {name: {"file_url": f"{base}/put/{name}"}}})
                if method == "POST" and self.path.endswith("/start"):
                    return self._send(200, {"job_state": "Running"})
                if method == "GET" and self.path.endswith("/status"):
                    return self._send(200, {"job_state": fake.state, "job_details": [{"outputs": [{"file_name": "0.json"}]}]})
                if method == "POST" and self.path == "/speech-to-text/job/v1/download-files":
                    return self._send(200, {"download_urls": {"0.json": {"file_url": f"{base}/out/0.json"}}})
                return self._send(404, {"error": "no such route"})

            def do_GET(self):
                self._route("GET")

            def do_POST(self):
                self._route("POST")

            def do_PUT(self):
                self._route("PUT")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def closed_port_url() -> str:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return f"http://127.0.0.1:{port}"


def tone(seconds: float = 3.0) -> np.ndarray:
    t = np.arange(int(16000 * seconds)) / 16000.0
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


class SarvamClientTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeSarvam()
        self.tmp = tempfile.mkdtemp()
        self.audio = Path(self.tmp) / "call.mp3"
        self.audio.write_bytes(b"ID3-fake-audio")

    def tearDown(self):
        self.fake.close()

    def client(self, key=KEY):
        return SarvamClient(key, base=self.fake.url, poll_seconds=0.01, timeout_seconds=5)

    def test_full_batch_flow_uploads_the_file_and_returns_the_transcript(self):
        result = self.client().transcribe_file(self.audio, "hi")
        self.assertEqual(result["transcript"], TRANSCRIPT)
        self.assertEqual(self.fake.uploaded, b"ID3-fake-audio")
        create = json.loads(next(body for method, path, body in self.fake.calls if path == "/speech-to-text/job/v1"))
        self.assertEqual(create["job_parameters"], {"language_code": "hi-IN", "model": "saaras:v4"})

    def test_auto_language_asks_sarvam_to_detect_it(self):
        self.client().transcribe_file(self.audio, "auto")
        create = json.loads(next(body for method, path, body in self.fake.calls if path == "/speech-to-text/job/v1"))
        self.assertEqual(create["job_parameters"]["language_code"], "unknown")

    def test_wrong_key_is_reported_clearly(self):
        with self.assertRaisesRegex(SarvamError, "rejected the API key"):
            self.client(key="wrong").transcribe_file(self.audio, "hi")

    def test_quota_is_reported_clearly(self):
        self.fake.quota = True
        with self.assertRaisesRegex(SarvamError, "quota"):
            self.client().transcribe_file(self.audio, "hi")

    def test_failed_job_raises(self):
        self.fake.state = "Failed"
        with self.assertRaisesRegex(SarvamError, "could not process"):
            self.client().transcribe_file(self.audio, "hi")

    def test_unreachable_service_raises_sarvam_error(self):
        client = SarvamClient(KEY, base=closed_port_url(), poll_seconds=0.01, timeout_seconds=5)
        with self.assertRaisesRegex(SarvamError, "Could not reach Sarvam"):
            client.transcribe_file(self.audio, "hi")


class PipelineSarvamTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeSarvam()
        self.tmp = tempfile.mkdtemp()
        self.audio = Path(self.tmp) / "call.mp3"
        self.audio.write_bytes(b"ID3-fake-audio")
        self.local = helpers.FakeBackend("faster-whisper", language="hi", text="local text for the fallback case")

    def tearDown(self):
        self.fake.close()

    def pipeline(self, base, **overrides):
        settings = helpers.settings(self.tmp, sarvam_api_key=KEY, **overrides)
        pipeline = Pipeline(settings, AsrEngine(settings, helpers.FakeBackend("i"), self.local))
        pipeline.sarvam = SarvamClient(KEY, base=base, poll_seconds=0.01, timeout_seconds=5)
        return pipeline

    def test_sarvam_transcript_is_used_and_cached(self):
        pipeline = self.pipeline(self.fake.url)
        transcription = pipeline._transcribe_audio(self.audio, tone(), "hi", lambda *a: None, lambda: False)
        self.assertEqual(transcription.engine, "sarvam")
        self.assertEqual(transcription.text, TRANSCRIPT)
        self.assertEqual(transcription.language, "hi")
        uploads = len(self.fake.calls)
        again = pipeline._transcribe_audio(self.audio, tone(), "hi", lambda *a: None, lambda: False)
        self.assertEqual(again.text, TRANSCRIPT)
        self.assertEqual(len(self.fake.calls), uploads, "a second run of the same recording must not call Sarvam again")

    def test_falls_back_to_local_model_with_a_warning_when_sarvam_fails(self):
        pipeline = self.pipeline(closed_port_url())
        transcription = pipeline._transcribe_audio(self.audio, tone(), "hi", lambda *a: None, lambda: False)
        self.assertNotEqual(transcription.engine, "sarvam")
        self.assertTrue(any("Sarvam AI was not used" in warning for warning in transcription.warnings))

    def test_no_key_means_no_cloud_call(self):
        settings = helpers.settings(self.tmp)
        pipeline = Pipeline(settings, AsrEngine(settings, helpers.FakeBackend("i"), self.local))
        self.assertIsNone(pipeline.sarvam)
        self.assertFalse(pipeline.status()["sarvam"]["enabled"])

    def test_local_backend_setting_keeps_audio_on_this_machine(self):
        settings = helpers.settings(self.tmp, sarvam_api_key=KEY, asr_backend="whisper")
        pipeline = Pipeline(settings, AsrEngine(settings, helpers.FakeBackend("i"), self.local))
        self.assertIsNone(pipeline.sarvam)


if __name__ == "__main__":
    unittest.main()
