"""A small Ollama client built on the standard library, plus automatic choice of the best installed model."""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

# Best first. A name matches by prefix, so "gemma4:12b" also finds "gemma4:12b-it-q4_K_M".
PREFERRED_MODELS = [
    "gemma4:12b", "gemma4:26b", "gemma4:e4b", "gemma4:e2b", "gemma4", "qwen3.6:27b", "qwen3:14b",
    "gemma3:12b", "gemma3:27b", "qwen3:8b", "qwen2.5:14b", "qwen2.5:7b", "llama3.1:8b", "gemma3:4b",
]
_NOT_CHAT = re.compile(r"embed|bge|nomic|minilm|whisper|rerank|clip|llava|vision-only", re.I)
# Models this small cannot follow the analysis instructions: they make up customers, quotes, competitors and even
# languages that nobody spoke (a 1B model once reported a Spanish "app design" job as a competitor). They are never
# picked automatically; an OLLAMA_MODEL set on purpose still works but the result is flagged.
MIN_AUTO_GB = 2.0
_TOO_SMALL = re.compile(r"tinyllama|smollm|[:\-_]\d+m\b|[:\-_]0?\.\d+b\b|[:\-_][12](?:\.\d+)?b\b", re.I)
RECOMMENDED_PULL = "ollama pull gemma4:e4b"
LIGHTER_PULL = "ollama pull gemma4:e2b"


class LlmError(Exception):
    pass


def is_small_model(name: str, size_gb: float = 0.0) -> bool:
    """True for models too small to analyse a conversation reliably (judged by name, and by disk size when Ollama reports it)."""
    return bool(_TOO_SMALL.search(name or "")) or (0 < size_gb < MIN_AUTO_GB)


def choose_model(installed: list[dict], preferred: str | None = None, max_gb: float = 10.0) -> str | None:
    names = [item.get("name", "") for item in installed]
    if preferred:
        for name in names:
            if name == preferred or name.startswith(preferred + "-") or name.split(":")[0] == preferred:
                return name
        return None
    sizes = {item.get("name", ""): float(item.get("size") or 0) / 1e9 for item in installed}
    usable = [name for name in names if name and not _NOT_CHAT.search(name) and not is_small_model(name, sizes[name])
              and (sizes[name] <= max_gb or sizes[name] == 0)]
    for wanted in PREFERRED_MODELS:
        for name in usable:
            if name == wanted or name.startswith(wanted + "-") or (":" not in wanted and name.split(":")[0] == wanted):
                return name
    return max(usable, key=lambda name: sizes[name], default=None)


def repair_json(text: str) -> str | None:
    """Closes a JSON document that was cut off mid-way: drops the unfinished last item and adds the missing brackets."""
    stack: list[str] = []
    in_string = escaped = False
    cuts: list[tuple[int, str]] = []
    for index, char in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            stack.append("}" if char == "{" else "]")
        elif char in "}]":
            if not stack:
                break
            stack.pop()
            cuts.append((index + 1, "".join(reversed(stack))))
        elif char == ",":
            cuts.append((index, "".join(reversed(stack))))
    for index, closers in reversed(cuts):
        candidate = text[:index] + closers
        try:
            if isinstance(json.loads(candidate), dict):
                return candidate
        except ValueError:
            continue
    return None


def parse_json_reply(content: str) -> dict:
    text = (content or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise LlmError("The model did not return JSON.")
        try:
            value = json.loads(match.group(0))
        except json.JSONDecodeError as error:
            fixed = repair_json(match.group(0))
            if fixed is None:
                raise LlmError(f"The model returned broken JSON: {error}") from error
            value = json.loads(fixed)
            value["_cut_off"] = True  # the answer ended early; the last items were dropped
    if not isinstance(value, dict):
        raise LlmError("The model returned JSON that is not an object.")
    return value


class OllamaClient:
    def __init__(self, base_url: str, timeout: int = 900, num_ctx: int = 16384, model: str | None = None, max_gb: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.num_ctx = num_ctx
        self.requested_model = model
        self.max_gb = max_gb
        self._model: str | None = None
        self.small = False

    def _call(self, path: str, payload: dict | None = None, timeout: float | None = None) -> dict:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(self.base_url + path, data=data, method="GET" if data is None else "POST",
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout or self.timeout) as reply:
                return json.loads(reply.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            raise LlmError(f"Ollama returned HTTP {error.code}: {detail}") from error
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as error:
            raise LlmError(f"Could not reach Ollama at {self.base_url}. Start the Ollama app and try again ({error}).") from error
        except json.JSONDecodeError as error:
            raise LlmError("Ollama sent an unreadable reply.") from error

    def installed(self) -> list[dict]:
        return list(self._call("/api/tags", timeout=10).get("models") or [])

    def _no_model_message(self, installed: list[dict]) -> str:
        """Explains what is wrong and what to run; names the tiny models that were skipped so nobody wonders why they are ignored."""
        if self.requested_model:
            return f"The Ollama model '{self.requested_model}' is not installed. Run: ollama pull {self.requested_model}"
        skipped = [item.get("name", "") for item in installed if item.get("name") and not _NOT_CHAT.search(item["name"])
                   and is_small_model(item["name"], float(item.get("size") or 0) / 1e9)]
        if skipped:
            return (f"Only very small Ollama models are installed ({', '.join(skipped)}). They invent customers, quotes and competitors, "
                    f"so the engine will not use them. Run: {RECOMMENDED_PULL}   (or the lighter {LIGHTER_PULL})")
        return f"No suitable Ollama model is installed. Run: {RECOMMENDED_PULL}   (or the lighter {LIGHTER_PULL})"

    def _is_small(self, chosen: str | None, installed: list[dict]) -> bool:
        size = next((float(item.get("size") or 0) / 1e9 for item in installed if item.get("name") == chosen), 0.0)
        return bool(chosen) and is_small_model(chosen, size)

    def resolve_model(self) -> str:
        if self._model:
            return self._model
        installed = self.installed()
        chosen = choose_model(installed, self.requested_model, self.max_gb)
        if not chosen:
            raise LlmError(self._no_model_message(installed))
        self._model = chosen
        self.small = self._is_small(chosen, installed)
        return chosen

    def status(self) -> dict:
        try:
            installed = self.installed()
        except LlmError as error:
            return {"ok": False, "detail": str(error), "model": None, "installed": []}
        chosen = choose_model(installed, self.requested_model, self.max_gb)
        small = self._is_small(chosen, installed)
        detail = "" if chosen else self._no_model_message(installed)
        if small:
            detail = f"{chosen} is a very small model and often makes things up. Better: {RECOMMENDED_PULL}"
        return {"ok": chosen is not None, "model": chosen, "installed": [item.get("name") for item in installed],
                "small": small, "detail": detail}

    def chat_json(self, system: str, user: str, schema: dict) -> dict:
        model = self.resolve_model()
        last_error: LlmError | None = None
        for attempt in range(2):
            payload = {
                "model": model, "stream": False, "format": schema, "think": False,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "options": {"temperature": 0.1 if attempt == 0 else 0.0, "num_ctx": self.num_ctx, "num_predict": 6000},
            }
            reply = self._call("/api/chat", payload)
            try:
                return parse_json_reply(str((reply.get("message") or {}).get("content", "")))
            except LlmError as error:
                last_error = error
        raise last_error or LlmError("The model gave no answer.")
