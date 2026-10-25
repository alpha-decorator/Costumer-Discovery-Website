"""Settings come from environment variables so nothing has to be edited to change a model or a port."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

ENGINE_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    token: str | None = None                  # ENGINE_TOKEN: if set, every request must send "Authorization: Bearer <token>"
    data_dir: Path = ENGINE_ROOT / "data"
    profile_path: Path = ENGINE_ROOT / "trata-profile.json"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str | None = None           # OLLAMA_MODEL: leave empty to pick the best installed model automatically
    ollama_max_gb: float = 10.0               # never auto-pick a model larger than this (GB on disk)
    num_ctx: int = 16384
    llm_timeout: int = 900
    part_chars: int = 14000                   # transcripts longer than this are analysed in parts and merged
    asr_backend: str = "auto"                 # auto | sarvam | indic | whisper (auto uses Sarvam when a key is set)
    sarvam_api_key: str | None = None         # SARVAM_API_KEY: cloud speech to text; audio is uploaded to Sarvam when set
    sarvam_model: str = "saaras:v4"           # SARVAM_MODEL
    indic_model: str = "ai4bharat/indic-conformer-600m-multilingual"
    indic_revision: str | None = None         # INDIC_REVISION: pin a commit hash to freeze the downloaded model code
    indic_decoder: str = "ctc"                # ctc (faster) | rnnt (usually a little more accurate)
    whisper_model: str = "large-v3-turbo"
    device: str = "auto"                      # auto | cpu | cuda
    report_language: str = "en"               # language of summaries and notes: en | hi
    max_upload_mb: int = 600
    max_audio_minutes: int = 180


def _text(env: Mapping[str, str], name: str, default: str | None = None) -> str | None:
    value = env.get(name)
    return default if value is None or not value.strip() else value.strip()


def _number(env: Mapping[str, str], name: str, default, cast):
    value = _text(env, name)
    if value is None:
        return default
    try:
        return cast(value)
    except ValueError:
        raise SystemExit(f"{name} must be a number, got {value!r}")


HF_TOKEN_FILE = ENGINE_ROOT / "hf_token.txt"


def _apply_hf_token_file(path: Path = HF_TOKEN_FILE) -> bool:
    """The Hindi speech model is behind a free Hugging Face licence. Pasting the token into engine/hf_token.txt is the easy way to
    give it to the engine; HF_TOKEN set in the environment still wins. Returns True when the file supplied the token."""
    if os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"):
        return False
    try:
        token = path.read_text(encoding="utf-8-sig").strip().splitlines()[0].strip()
    except (OSError, IndexError):
        return False
    if not token:
        return False
    os.environ["HF_TOKEN"] = token
    return True


SARVAM_KEY_FILE = ENGINE_ROOT / "sarvam_api_key.txt"


def _read_first_line(path: Path) -> str | None:
    try:
        line = path.read_text(encoding="utf-8-sig").strip().splitlines()[0].strip()
    except (OSError, IndexError):
        return None
    return line or None


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    if env is None:
        _apply_hf_token_file()
        # The Sarvam key can also be pasted into engine/sarvam_api_key.txt (one line). SARVAM_API_KEY in the environment wins.
        if not os.environ.get("SARVAM_API_KEY"):
            key = _read_first_line(SARVAM_KEY_FILE)
            if key:
                os.environ["SARVAM_API_KEY"] = key
    env = os.environ if env is None else env
    backend = (_text(env, "ASR_BACKEND", "auto") or "auto").lower()
    if backend not in {"auto", "sarvam", "indic", "whisper"}:
        raise SystemExit("ASR_BACKEND must be auto, sarvam, indic or whisper")
    decoder = (_text(env, "INDIC_DECODER", "ctc") or "ctc").lower()
    if decoder not in {"ctc", "rnnt"}:
        raise SystemExit("INDIC_DECODER must be ctc or rnnt")
    report_language = (_text(env, "REPORT_LANGUAGE", "en") or "en").lower()
    if report_language not in {"en", "hi"}:
        raise SystemExit("REPORT_LANGUAGE must be en or hi")
    data_dir = Path(_text(env, "ENGINE_DATA_DIR", str(ENGINE_ROOT / "data")))
    return Settings(
        host=_text(env, "ENGINE_HOST", "127.0.0.1"),
        port=_number(env, "ENGINE_PORT", 8765, int),
        token=_text(env, "ENGINE_TOKEN"),
        data_dir=data_dir,
        profile_path=Path(_text(env, "TRATA_PROFILE", str(ENGINE_ROOT / "trata-profile.json"))),
        ollama_url=(_text(env, "OLLAMA_URL", "http://127.0.0.1:11434") or "").rstrip("/"),
        ollama_model=_text(env, "OLLAMA_MODEL"),
        ollama_max_gb=_number(env, "OLLAMA_MAX_GB", 10.0, float),
        num_ctx=_number(env, "OLLAMA_NUM_CTX", 16384, int),
        llm_timeout=_number(env, "LLM_TIMEOUT", 900, int),
        part_chars=_number(env, "ANALYSIS_PART_CHARS", 14000, int),
        asr_backend=backend,
        sarvam_api_key=_text(env, "SARVAM_API_KEY"),
        sarvam_model=_text(env, "SARVAM_MODEL", "saaras:v4"),
        indic_model=_text(env, "INDIC_MODEL", "ai4bharat/indic-conformer-600m-multilingual"),
        indic_revision=_text(env, "INDIC_REVISION"),
        indic_decoder=decoder,
        whisper_model=_text(env, "WHISPER_MODEL", "large-v3-turbo"),
        device=(_text(env, "ENGINE_DEVICE", "auto") or "auto").lower(),
        report_language=report_language,
        max_upload_mb=_number(env, "MAX_UPLOAD_MB", 600, int),
        max_audio_minutes=_number(env, "MAX_AUDIO_MINUTES", 180, int),
    )
