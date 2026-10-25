"""Speech to text.

Hindi (and Hinglish) goes to AI4Bharat IndicConformer, the most accurate free model for Indian languages.
English, language detection and any failure fall back to Whisper large-v3-turbo through faster-whisper.
The two heavy libraries are imported only when first needed, so the engine starts instantly.
"""
from __future__ import annotations

import importlib.util
import re
import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .audio import SAMPLE_RATE, chunk_has_speech, plan_chunks, slice_audio
from .config import Settings

Progress = Callable[[str, float, str], None]


class AsrError(Exception):
    pass


class Cancelled(Exception):
    pass


@dataclass
class Transcription:
    text: str
    language: str
    engine: str
    model: str
    warnings: list[str] = field(default_factory=list)
    segments: list[dict] = field(default_factory=list)


def collapse_repeats(text: str, max_repeat: int = 2) -> str:
    """Speech models sometimes loop ("thank you thank you thank you ..."). Keep at most `max_repeat` copies of any 1-6 word phrase."""
    words = text.split()
    for size in range(1, 7):
        index = 0
        output: list[str] = []
        while index < len(words):
            phrase = words[index:index + size]
            repeats = 1
            while words[index + repeats * size: index + (repeats + 1) * size] == phrase and len(phrase) == size:
                repeats += 1
            if repeats > max_repeat + 1 and len(phrase) == size:
                output.extend(phrase * max_repeat)
                index += repeats * size
            else:
                output.append(words[index])
                index += 1
        words = output
    return " ".join(words)


def _clean(text) -> str:
    if isinstance(text, (list, tuple)):
        text = " ".join(_clean(item) for item in text)
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _missing(*modules: str) -> list[str]:
    return [name for name in modules if importlib.util.find_spec(name) is None]


def hindi_or_english(scores: dict[str, float], top: str = "hi") -> str:
    """The calls are Hindi (often mixed with English) or English, nothing else. Whisper ranks 99 languages and, on a noisy phone
    line, can put Welsh or French first, so only these two are compared. Urdu counts as Hindi (the same spoken language). A call
    is called English only when English is clearly ahead, because Hindi calls start with "Hello sir" and are full of English words."""
    if not scores:
        return "en" if top == "en" else "hi"
    english = scores.get("en", 0.0)
    hindi = scores.get("hi", 0.0) + scores.get("ur", 0.0)
    return "en" if english >= 0.5 and english > 2 * hindi else "hi"


# Whisper invents these on silence and music (it learned them from subtitle files); nobody says them on a customer call.
_WHISPER_JUNK = re.compile(r"https?://|www\.|\.(?:com|org|net)\b|amara\.org|subtitles? by|thanks? for watching|please subscribe|like and subscribe", re.I)


def whisper_segment_is_junk(text: str, no_speech_prob: float = 0.0, avg_logprob: float = 0.0, compression_ratio: float = 0.0) -> bool:
    if _WHISPER_JUNK.search(text or ""):
        return True
    if compression_ratio > 2.4:  # the same words looping
        return True
    return no_speech_prob > 0.6 and avg_logprob < -1.0  # the model itself thinks this is not speech


def _is_locked(error: BaseException) -> bool:
    """True when Hugging Face refused access because the model's licence has not been accepted or no token was given."""
    text = f"{type(error).__name__} {error}".lower()
    return any(word in text for word in ("gated", "401", "403", "access to model", "restricted", "not authorized", "unauthorized", "log in", "login"))


class IndicConformerBackend:
    name = "indic-conformer"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model_name = settings.indic_model
        self._model = None
        self._torch = None
        self._open_until = 0.0     # when the "access is fine" answer stops being trusted (never, once it is yes)
        self._locked_until = 0.0   # when to ask Hugging Face again after a "locked" answer

    def locked_message(self) -> str:
        return (f"{self.model_name} is locked on Hugging Face (free, one-time step): open https://huggingface.co/{self.model_name} and press "
                "\"Agree and access repository\"; then create a token at https://huggingface.co/settings/tokens (type: Read), paste it into "
                "the file engine/hf_token.txt (or set HF_TOKEN), and restart the engine. Until then Whisper is used for Hindi, which is less accurate")

    def check_access(self) -> bool:
        """Asks Hugging Face whether this computer may download the model. Only a clear 'locked' answer says no: being offline or
        having the model cached already must not block anything."""
        try:
            from huggingface_hub import get_hf_file_metadata, hf_hub_url

            get_hf_file_metadata(hf_hub_url(self.model_name, "config.json", revision=self.settings.indic_revision), timeout=4)
        except Exception as error:
            return not _is_locked(error)
        return True

    def availability(self) -> tuple[bool, str]:
        missing = _missing("torch", "transformers", "onnxruntime")
        if missing:
            return False, "missing Python packages: " + ", ".join(missing)
        now = time.monotonic()
        if self._open_until == float("inf"):
            return True, ""
        if now < self._locked_until:
            return False, self.locked_message()
        if self.check_access():
            self._open_until = float("inf")
            return True, ""
        self._locked_until = now + 30  # re-check soon: the person may be accepting the licence right now
        return False, self.locked_message()

    def load(self) -> None:
        if self._model is not None:
            return
        ok, reason = self.availability()
        if not ok:
            raise AsrError(f"IndicConformer unavailable ({reason})")
        import torch
        from transformers import AutoModel

        options = {"trust_remote_code": True}
        if self.settings.indic_revision:
            options["revision"] = self.settings.indic_revision
        self._torch = torch
        try:
            self._model = AutoModel.from_pretrained(self.model_name, **options)
        except Exception as error:
            if _is_locked(error):
                raise AsrError(self.locked_message()) from error
            raise

    def transcribe(self, audio: np.ndarray, language: str = "hi") -> str:
        self.load()
        wave = self._torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).unsqueeze(0)
        with self._torch.no_grad():
            return _clean(self._model(wave, language, self.settings.indic_decoder))


class WhisperBackend:
    name = "faster-whisper"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model_name = settings.whisper_model
        self._model = None

    def availability(self) -> tuple[bool, str]:
        missing = _missing("faster_whisper")
        return (False, "missing Python package: faster-whisper") if missing else (True, "")

    def _device(self) -> tuple[str, str]:
        if self.settings.device in {"cpu", "cuda"}:
            device = self.settings.device
        else:
            try:
                import ctranslate2
                device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
            except Exception:
                device = "cpu"
        return device, ("float16" if device == "cuda" else "int8")

    def load(self) -> None:
        if self._model is not None:
            return
        ok, reason = self.availability()
        if not ok:
            raise AsrError(f"Whisper unavailable ({reason})")
        from faster_whisper import WhisperModel

        device, compute = self._device()
        self._model = WhisperModel(self.model_name, device=device, compute_type=compute)

    def language_scores(self, audio: np.ndarray) -> dict[str, float]:
        self.load()
        sample = np.ascontiguousarray(audio[: 30 * SAMPLE_RATE], dtype=np.float32)
        result = self._model.detect_language(sample)
        scores = {str(code): float(prob) for code, prob in (result[2] if len(result) > 2 and result[2] else [])}
        return scores or {str(result[0]): float(result[1])}

    def detect_language(self, audio: np.ndarray) -> tuple[str, float]:
        scores = self.language_scores(audio)
        code = hindi_or_english(scores, max(scores, key=scores.get))
        return code, scores.get(code, 0.0)

    def transcribe(self, audio: np.ndarray, language: str | None = None) -> str:
        self.load()
        segments, _ = self._model.transcribe(
            np.ascontiguousarray(audio, dtype=np.float32), language=language, beam_size=5,
            condition_on_previous_text=False, vad_filter=False,
        )
        kept = [segment.text for segment in segments if not whisper_segment_is_junk(
            segment.text, getattr(segment, "no_speech_prob", 0.0), getattr(segment, "avg_logprob", 0.0), getattr(segment, "compression_ratio", 0.0))]
        return _clean(" ".join(kept))


class AsrEngine:
    def __init__(self, settings: Settings, indic=None, whisper=None):
        self.settings = settings
        self.indic = indic or IndicConformerBackend(settings)
        self.whisper = whisper or WhisperBackend(settings)

    def status(self) -> dict:
        indic_ok, indic_reason = self.indic.availability()
        whisper_ok, whisper_reason = self.whisper.availability()
        return {
            "backend": self.settings.asr_backend,
            "indic": {"available": indic_ok, "model": self.indic.model_name, "reason": indic_reason},
            "whisper": {"available": whisper_ok, "model": self.whisper.model_name, "reason": whisper_reason},
        }

    def _decide_language(self, audio, chunks, speech, hint: str, warnings: list[str]) -> str:
        if hint in {"hi", "en"}:
            return hint
        ok, _ = self.whisper.availability()
        if not ok:
            warnings.append("Language detection needs Whisper, so Hindi was assumed.")
            return "hi"
        voiced = [slice_audio(audio, s, e) for (s, e), flag in zip(chunks, speech) if flag] or [audio]
        # Listen to the start, the middle and the end: a Hindi call opens with an English "Hello", an English one may open in Hindi.
        samples = [voiced[i] for i in sorted({0, len(voiced) // 2, len(voiced) - 1})]
        try:
            if hasattr(self.whisper, "language_scores"):
                totals: dict[str, float] = {}
                for sample in samples:
                    for code, prob in self.whisper.language_scores(sample).items():
                        totals[code] = totals.get(code, 0.0) + prob / len(samples)
                return hindi_or_english(totals, max(totals, key=totals.get) if totals else "hi")
            code, _ = self.whisper.detect_language(samples[0])
        except Exception as error:
            warnings.append(f"Language detection failed ({error}); Hindi assumed.")
            return "hi"
        return "en" if code == "en" else "hi"

    def transcribe(self, audio: np.ndarray, language_hint: str = "auto", progress: Progress | None = None,
                   cancelled: Callable[[], bool] | None = None) -> Transcription:
        progress = progress or (lambda stage, fraction, message="": None)
        cancelled = cancelled or (lambda: False)
        warnings: list[str] = []
        chunks = plan_chunks(audio)
        speech = chunk_has_speech(audio, chunks)
        if not any(speech):
            raise AsrError("No speech was found in this recording.")
        progress("loading", 0.0, "speech models")  # the first run downloads several GB, so say so instead of looking frozen
        language = self._decide_language(audio, chunks, speech, language_hint, warnings)

        backend_choice = self.settings.asr_backend
        use_indic = language == "hi" and backend_choice in {"auto", "indic"}
        if use_indic:
            ok, reason = self.indic.availability()
            if not ok:
                if backend_choice == "indic":
                    raise AsrError(f"ASR_BACKEND=indic but IndicConformer is unavailable: {reason}")
                warnings.append(f"IndicConformer unavailable ({reason}); Whisper was used for Hindi, which is less accurate.")
                use_indic = False
        if not use_indic:
            ok, reason = self.whisper.availability()
            if not ok:
                raise AsrError(f"No speech model is available: {reason}")

        engine_used = self.indic if use_indic else self.whisper
        progress("loading", 0.0, engine_used.model_name)
        texts: list[str] = []
        segments: list[dict] = []
        total_speech = max(1, sum(1 for flag in speech if flag))
        done = 0
        for (start, end), voiced in zip(chunks, speech):
            if cancelled():
                raise Cancelled()
            if not voiced:
                continue
            piece = slice_audio(audio, start, end)
            text = ""
            try:
                text = engine_used.transcribe(piece, "hi") if use_indic else self.whisper.transcribe(piece, language)
            except Exception as error:
                if use_indic and backend_choice == "auto":
                    warnings.append(f"IndicConformer failed ({error}); Whisper was used for the rest of this recording.")
                    use_indic = False
                    engine_used = self.whisper
                    text = self.whisper.transcribe(piece, "hi")
                else:
                    raise AsrError(f"Speech recognition failed: {error}") from error
            if text:
                texts.append(text)
                segments.append({"start": round(start, 2), "end": round(end, 2), "text": text})
            done += 1
            progress("transcribing", done / total_speech, f"{int(end)}s / {int(len(audio) / SAMPLE_RATE)}s")

        # One line per audio chunk: chunks end in a pause, which is where speakers usually change, so the line breaks help the
        # speaker-labelling step. Loops are collapsed inside each chunk.
        full = "\n".join(line for line in (collapse_repeats(text) for text in texts) if line)
        if not full.strip():
            raise AsrError("The speech model returned no text.")
        return Transcription(text=full, language=language, engine=engine_used.name, model=engine_used.model_name,
                             warnings=warnings, segments=segments)
