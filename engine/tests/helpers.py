import json
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from trata_engine.config import Settings  # noqa: E402


def good_reply(transcript: str) -> dict:
    """What a well-behaved model would answer, decided from simple keywords in the transcript."""
    if "great idea" in transcript:
        label, score, quote = "strong_positive", 0.8, "that is exactly why I think this is a great idea"
    elif "पैसे" in transcript:
        label, score, quote = "negative", -0.6, "मैं तो नहीं दूँगा"
    else:
        label, score, quote = "not_discussed", 0.0, ""
    return {
        "summary": "Customer talked about the product.", "language": "hi" if "पैसे" in transcript else "en",
        "customer": {"role": "professional_driver" if "truck" in transcript else "unclear", "transport": ["commercial_vehicle"] if "truck" in transcript else [],
                     "accident_experience": "unclear", "understood_idea": "clear" if score else "unclear"},
        "qa": [{"question": "Would you use it?", "answer": "Yes, on trucks", "tone": "positive", "evidence": "I would install it on my truck"}] if score > 0 else [],
        "problem_concern": {"level": "high", "note": "Cares a lot about road safety."},
        "attitude_to_product": {"reasoning": "Opinion about Trata.", "evidence": [quote] if quote else [], "label": label, "score": score},
        "would_use": "yes" if score > 0 else "no" if score < 0 else "unclear", "would_pay": "no" if score < 0 else "unclear",
        "topics": {"ux": {"discussed": False, "score": 0}, "pricing": {"discussed": score < 0, "score": -0.7 if score < 0 else 0},
                   "features": {"discussed": score > 0, "score": 0.7 if score > 0 else 0}},
        "features": [{"name": "Black spot alert", "stance": "positive", "score": 0.8, "importance": "must_have", "evidence": "I would install it on my truck"}] if score > 0 else [],
        "mentions": [{"type": "pricing", "text": "Will not pay 500 rupees a month", "evidence": "मैं तो नहीं दूँगा"}] if score < 0 else
                    [{"type": "use_case", "text": "Wants it on trucks", "evidence": "install it on my truck"}] if score > 0 else [],
        "key_points": ["A key point"], "alternatives": [],
    }


def label_lines(prompt: str) -> dict:
    """A stand-in for the speaker-labelling model: the first line and every line with a question mark is the interviewer."""
    import re
    lines = re.findall(r"^\[(\d+)\] (.*)$", prompt.split("Label these lines:")[-1], re.M)
    turns = []
    for position, (number, text) in enumerate(lines):
        who = "interviewer" if position == 0 or "?" in text or "पिच" in text else "customer"
        if turns and turns[-1]["who"] == who:
            turns[-1]["to"] = int(number)
        else:
            turns.append({"from": int(number), "to": int(number), "who": who})
    return {"turns": turns}


class FakeOllama:
    """Pretends to be Ollama. `replies` is a queue of raw strings to return first (to test broken output); then it answers normally."""

    def __init__(self, models=None):
        self.models = models if models is not None else [{"name": "gemma4:e4b", "size": 5_000_000_000}]
        self.requests: list[dict] = []
        self.replies: list[str] = []          # raw answers for the next ANALYSIS requests
        self.speaker_replies: list[str] = []  # raw answers for the next speaker-labelling requests
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _json(self, body):
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                self._json({"models": owner.models})

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.requests.append(payload)
                is_speaker = "turns" in payload["format"].get("properties", {})
                if is_speaker and owner.speaker_replies:
                    content = owner.speaker_replies.pop(0)
                elif is_speaker:
                    content = json.dumps(label_lines(payload["messages"][-1]["content"]))
                elif owner.replies:
                    content = owner.replies.pop(0)
                else:
                    user = payload["messages"][-1]["content"]
                    content = json.dumps(good_reply(user), ensure_ascii=False)
                self._json({"message": {"role": "assistant", "content": content}})

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class FakeBackend:
    def __init__(self, name, model="fake", available=True, reason="", text="नमस्ते यह एक परीक्षण है", language="hi", fail=False):
        self.name, self.model_name, self._available, self._reason = name, model, available, reason
        self.text, self.language, self.fail = text, language, fail
        self.calls = 0

    def availability(self):
        return (self._available, self._reason)

    def load(self):
        pass

    def detect_language(self, audio):
        return self.language, 0.9

    def transcribe(self, audio, language=None):
        self.calls += 1
        if self.fail:
            raise RuntimeError("model exploded")
        return self.text


def speech_like(seconds: float, gaps: list[tuple[float, float]] = (), sr: int = 16000) -> np.ndarray:
    """Noise bursts standing in for speech, with silence at the given (start, end) seconds."""
    rng = np.random.default_rng(1)
    audio = (rng.standard_normal(int(seconds * sr)) * 0.1).astype(np.float32)
    for start, end in gaps:
        audio[int(start * sr):int(end * sr)] = 0
    return audio


def write_wav(path, audio: np.ndarray, sr: int = 16000) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sr)
        handle.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def settings(tmp, ollama_url="http://127.0.0.1:1", **overrides) -> Settings:
    base = dict(data_dir=Path(tmp), ollama_url=ollama_url, port=0, llm_timeout=20, part_chars=14000)
    base.update(overrides)
    return Settings(**base)


def analysis_requests(fake) -> list[dict]:
    return [r for r in fake.requests if "attitude_to_product" in r["format"].get("properties", {})]


def speaker_requests(fake) -> list[dict]:
    return [r for r in fake.requests if "turns" in r["format"].get("properties", {})]
