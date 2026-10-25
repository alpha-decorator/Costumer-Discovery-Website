import http.client
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

import helpers
from trata_engine.asr import AsrEngine
from trata_engine.jobs import JobManager
from trata_engine.llm import OllamaClient
from trata_engine.pipeline import Pipeline
from trata_engine.server import EngineServer, make_server


class SlowIndic(helpers.FakeBackend):
    delay = 0.0

    def transcribe(self, audio, language=None):
        time.sleep(self.delay)
        return super().transcribe(audio, language)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = helpers.FakeOllama()
        cls.tmp = tempfile.mkdtemp()
        cls.settings = helpers.settings(cls.tmp, ollama_url=cls.fake.url, host="127.0.0.1", port=0)
        cls.indic = SlowIndic("indic-conformer", text="सड़क हादसे बहुत होते हैं पर इसके पैसे कौन देगा मैं तो नहीं दूँगा " * 3)
        asr = AsrEngine(cls.settings, cls.indic, helpers.FakeBackend("faster-whisper", language="hi"))
        pipeline = Pipeline(cls.settings, asr, OllamaClient(cls.fake.url, 20, 8192))
        cls.server = make_server(cls.settings, pipeline)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.wav = Path(cls.tmp, "a.wav")
        helpers.write_wav(cls.wav, helpers.speech_like(6))

    @classmethod
    def tearDownClass(cls):
        cls.server.manager.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.fake.close()

    def call(self, method, path, body=None, headers=None, host=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        merged = {"Host": host or f"127.0.0.1:{self.port}", **(headers or {})}
        connection.request(method, path, body=body, headers=merged)
        response = connection.getresponse()
        data = json.loads(response.read().decode("utf-8") or "{}")
        connection.close()
        return response.status, data

    def wait(self, job_id, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            status, job = self.call("GET", f"/jobs/{job_id}")
            if job["status"] in {"done", "error", "cancelled"}:
                return job
            time.sleep(0.05)
        self.fail("job did not finish")

    def test_health(self):
        status, body = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"] and body["llm"]["ok"])
        self.assertEqual(body["llm"]["model"], "gemma4:e4b")
        self.assertTrue(body["asr"]["indic"]["available"])

    def test_browsers_and_wrong_hosts_are_refused(self):
        self.assertEqual(self.call("GET", "/health", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.call("GET", "/health", host="evil.example")[0], 403)
        self.assertEqual(self.call("GET", "/nope")[0], 404)
        self.assertEqual(self.call("GET", "/jobs/0123456789abcdef")[0], 404)
        self.assertEqual(self.call("GET", "/jobs/../../etc/passwd")[0], 404)

    def test_audio_job_end_to_end(self):
        status, job = self.call("POST", "/jobs?kind=audio&language=hi&filename=ramesh.wav&client_key=ramesh-1", self.wav.read_bytes(), {"Content-Type": "application/octet-stream"})
        self.assertEqual(status, 202)
        self.assertFalse(job["reused"])
        done = self.wait(job["id"])
        self.assertEqual(done["status"], "done", done.get("error"))
        result = done["result"]
        self.assertEqual(result["language"], "hi")
        self.assertAlmostEqual(result["durationSec"], 6.0, delta=0.1)
        self.assertIn("मैं तो नहीं दूँगा", result["transcript"])
        analysis = result["analysis"]
        self.assertEqual(analysis["ideaSentiment"]["label"], "negative")
        self.assertEqual(analysis["meta"]["asrEngine"], "indic-conformer")
        self.assertEqual(analysis["meta"]["llmModel"], "gemma4:e4b")
        self.assertTrue(any(m["type"] == "pricing" and m["evidence"]["verified"] for m in analysis["mentions"]))
        self.assertEqual(done["progress"], 1.0)
        # the uploaded file is deleted once processed
        self.assertEqual(list(Path(self.settings.data_dir, "uploads").glob("*")), [])
        # same key again: no second upload is processed, same job comes back
        status, again = self.call("POST", "/jobs?kind=audio&language=hi&client_key=ramesh-1", self.wav.read_bytes())
        self.assertEqual((status, again["id"], again["reused"]), (200, job["id"], True))
        # and it survives an engine restart
        reloaded = JobManager(self.settings.data_dir, None)
        self.assertEqual(reloaded.find_by_key("ramesh-1").status, "done")

    def test_chunked_upload_and_text_job(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        data = self.wav.read_bytes()
        connection.putrequest("POST", "/jobs?kind=audio&language=hi&client_key=chunked-1", skip_host=True)
        connection.putheader("Host", f"127.0.0.1:{self.port}")
        connection.putheader("Transfer-Encoding", "chunked")
        connection.endheaders()
        for start in range(0, len(data), 7000):
            piece = data[start:start + 7000]
            connection.send(f"{len(piece):x}\r\n".encode() + piece + b"\r\n")
        connection.send(b"0\r\n\r\n")
        response = connection.getresponse()
        job = json.loads(response.read())
        self.assertEqual(response.status, 202)
        self.assertEqual(self.wait(job["id"])["status"], "done")
        text = "Interviewer: what do you think? Customer: Honestly this is a great idea and I would install it on my truck, " * 3
        status, job = self.call("POST", "/jobs?kind=text&language=en", json.dumps({"text": text}).encode(), {"Content-Type": "application/json"})
        self.assertEqual(status, 202)
        done = self.wait(job["id"])
        self.assertEqual(done["result"]["analysis"]["ideaSentiment"]["label"], "strong_positive")
        self.assertEqual(done["result"]["analysis"]["meta"]["asrEngine"], "text")
        self.assertEqual(self.call("POST", "/jobs?kind=text", b"{}")[0], 400)
        self.assertEqual(self.call("POST", "/jobs?kind=text", b"not json")[0], 400)
        self.assertEqual(self.call("POST", "/jobs?kind=zzz", b"{}")[0], 400)
        self.assertEqual(self.call("POST", "/jobs?language=klingon", b"x")[0], 400)

    def test_transcript_only_jobs_never_call_the_language_model(self):
        before = len(self.fake.requests)
        status, job = self.call("POST", "/jobs?kind=audio&language=hi&analyze=0&client_key=plain-1&filename=p.wav", self.wav.read_bytes())
        self.assertEqual(status, 202)
        done = self.wait(job["id"])
        self.assertEqual(done["status"], "done")
        result = done["result"]
        self.assertIsNone(result["analysis"])
        self.assertIn("पैसे", result["transcript"])
        self.assertEqual(result["language"], "hi")
        self.assertEqual(result["meta"]["asrEngine"], "indic-conformer")
        self.assertGreater(result["durationSec"], 0)
        self.assertEqual(len(self.fake.requests), before, "the language model must not be asked anything")
        # The same recording asked for with a full analysis is a different job, not the transcript-only result handed back.
        status, full = self.call("POST", "/jobs?kind=audio&language=hi&client_key=plain-1&filename=p.wav", self.wav.read_bytes())
        self.assertEqual(status, 202)
        self.assertNotEqual(full["id"], job["id"])
        self.assertIsNotNone(self.wait(full["id"])["result"]["analysis"])
        # Asking for the transcript-only version again returns the saved one.
        status, again = self.call("POST", "/jobs?kind=audio&language=hi&analyze=0&client_key=plain-1&filename=p.wav", self.wav.read_bytes())
        self.assertEqual((status, again["id"]), (200, job["id"]))

    def test_transcript_only_text_job(self):
        status, job = self.call("POST", "/jobs?kind=text&language=en&analyze=0", json.dumps({"text": "I like it. I would pay."}).encode(), {"Content-Type": "application/json"})
        self.assertEqual(status, 202)
        done = self.wait(job["id"])
        self.assertIsNone(done["result"]["analysis"])
        self.assertEqual(done["result"]["transcript"], "I like it. I would pay.")
        self.assertEqual(done["result"]["language"], "en")

    def test_bad_audio_reports_a_clear_error_and_worker_survives(self):
        status, job = self.call("POST", "/jobs?kind=audio&client_key=bad-1&filename=x.mp3", b"definitely not an audio file")
        done = self.wait(job["id"])
        self.assertEqual(done["status"], "error")
        self.assertIn("decode", done["error"].lower())
        status, ok = self.call("POST", "/jobs?kind=audio&language=hi&client_key=after-bad", self.wav.read_bytes())
        self.assertEqual(self.wait(ok["id"])["status"], "done")
        self.assertEqual(self.call("POST", "/jobs?kind=audio&client_key=empty", b"")[0], 400)

    def test_queue_order_and_cancel(self):
        self.indic.delay = 0.4
        # A recording no other test has sent: a transcript saved by an earlier test would make the jobs finish instantly and nothing would queue.
        fresh = Path(self.tmp, "queue.wav")
        helpers.write_wav(fresh, helpers.speech_like(4.7))
        try:
            ids = [self.call("POST", f"/jobs?kind=audio&language=hi&client_key=q-{i}", fresh.read_bytes())[1]["id"] for i in range(3)]
            time.sleep(0.1)
            status, last = self.call("GET", f"/jobs/{ids[2]}")
            self.assertEqual(last["status"], "queued")
            self.assertGreaterEqual(last["queuePosition"], 1)
            self.assertEqual(self.call("DELETE", f"/jobs/{ids[2]}")[0], 200)
            self.assertEqual(self.call("GET", f"/jobs/{ids[2]}")[1]["status"], "cancelled")
            self.assertEqual(self.wait(ids[0])["status"], "done")
            self.assertEqual(self.wait(ids[1])["status"], "done")
            self.assertEqual(self.call("DELETE", f"/jobs/{ids[0]}")[0], 404)   # already finished
        finally:
            self.indic.delay = 0.0


class SavedResultTests(unittest.TestCase):
    def test_results_saved_by_an_older_format_are_not_reused(self):
        from trata_engine import jobs
        tmp = Path(tempfile.mkdtemp())
        (tmp / "jobs").mkdir()
        base = {"kind": "audio", "clientKey": "k", "filename": "a.mp3", "status": "done", "result": {"analysis": {}}, "created": time.time(), "finished": time.time()}
        (tmp / "jobs" / "old.json").write_text(json.dumps({**base, "id": "old"}), encoding="utf-8")                                   # no resultVersion
        (tmp / "jobs" / "new.json").write_text(json.dumps({**base, "id": "new", "clientKey": "k2", "resultVersion": jobs.RESULT_VERSION}), encoding="utf-8")
        manager = jobs.JobManager(tmp, pipeline=None)
        self.assertNotIn("old", manager.jobs)
        self.assertFalse((tmp / "jobs" / "old.json").exists())
        self.assertIsNotNone(manager.find_by_key("k2"))
        self.assertIsNone(manager.find_by_key("k"))


class TokenTests(unittest.TestCase):
    def test_token_is_required_when_set(self):
        fake = helpers.FakeOllama()
        tmp = tempfile.mkdtemp()
        settings = helpers.settings(tmp, ollama_url=fake.url, token="s3cret-token")
        server = make_server(settings, Pipeline(settings, AsrEngine(settings, helpers.FakeBackend("i"), helpers.FakeBackend("w")), OllamaClient(fake.url, 5, 4096)))
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            def get(headers):
                c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                c.request("GET", "/health", headers=headers)
                return c.getresponse().status
            self.assertEqual(get({}), 401)
            self.assertEqual(get({"Authorization": "Bearer wrong"}), 401)
            self.assertEqual(get({"Authorization": "Bearer s3cret-token"}), 200)
        finally:
            server.manager.stop(); server.shutdown(); server.server_close(); fake.close()

    def test_refuses_to_listen_on_the_network_without_a_token(self):
        settings = helpers.settings(tempfile.mkdtemp(), host="0.0.0.0")
        with self.assertRaises(SystemExit):
            make_server(settings, None)


if __name__ == "__main__":
    unittest.main()
