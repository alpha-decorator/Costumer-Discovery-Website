"""Glue: decode -> transcribe -> analyse. Each step reports progress so the website can show a live bar."""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict
from typing import Callable

from .analyze import Analyzer, clean_transcript, script_language
from .asr import AsrEngine, Transcription
from .sarvam import SarvamClient, SarvamError
from .audio import SAMPLE_RATE, decode_audio
from .config import Settings
from .llm import OllamaClient
from .profile import Profile, load_profile

Progress = Callable[[str, float, str], None]

# How much of the progress bar each stage owns. Without the analysis step, speech to text owns the rest of the bar.
BANDS = {"decoding": (0.0, 0.04), "loading": (0.04, 0.04), "transcribing": (0.04, 0.60), "analyzing": (0.60, 1.0)}
BANDS_TRANSCRIPT_ONLY = {"decoding": (0.0, 0.04), "loading": (0.04, 0.04), "transcribing": (0.04, 1.0)}


def banded(progress: Progress | None, bands: dict | None = None) -> Progress:
    bands = bands or BANDS

    def report(stage: str, fraction: float, message: str = "") -> None:
        if progress:
            low, high = bands.get(stage, (0.0, 1.0))
            progress(stage, low + (high - low) * max(0.0, min(1.0, fraction)), message)
    return report


class Pipeline:
    def __init__(self, settings: Settings, asr: AsrEngine | None = None, llm: OllamaClient | None = None, profile: Profile | None = None):
        self.settings = settings
        self.asr = asr or AsrEngine(settings)
        self.llm = llm or OllamaClient(settings.ollama_url, settings.llm_timeout, settings.num_ctx, settings.ollama_model, settings.ollama_max_gb)
        self.profile = profile or load_profile(settings.profile_path)
        self.analyzer = Analyzer(settings, self.llm, self.profile)
        # Sarvam is a cloud service: it is used only with a key, and only when ASR_BACKEND allows it.
        self.sarvam = SarvamClient(settings.sarvam_api_key, settings.sarvam_model) if settings.sarvam_api_key and settings.asr_backend in {"auto", "sarvam"} else None

    def status(self) -> dict:
        return {"asr": self.asr.status(), "sarvam": {"enabled": self.sarvam is not None, "model": self.settings.sarvam_model if self.sarvam else None},
                "llm": self.llm.status(), "product": self.profile.name, "features": len(self.profile.features)}

    def _transcribe(self, audio, language: str, report, cancelled) -> Transcription:
        """Speech to text is the slow part, so a finished transcript is kept: if the analysis fails and the file is sent again, only the analysis reruns."""
        settings = self.settings
        digest = hashlib.sha1(audio.tobytes())
        digest.update(f"|{language}|{settings.asr_backend}|{settings.indic_model}|{settings.whisper_model}|{settings.indic_decoder}".encode())
        path = settings.data_dir / "transcripts" / f"{digest.hexdigest()}.json"
        try:
            cached = Transcription(**json.loads(path.read_text(encoding="utf-8")))
            if cached.text.strip():
                report("transcribing", 1.0, "")
                return cached
        except (OSError, ValueError, TypeError):
            pass
        transcription = self.asr.transcribe(audio, language, report, cancelled)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(asdict(transcription), ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, path)
        except OSError:
            pass
        return transcription

    def _transcribe_audio(self, path, audio, language: str, report, cancelled) -> Transcription:
        """Sarvam when it is set up; if it fails (no network, bad key, quota), the local speech models take over and say so."""
        if self.sarvam is None:
            return self._transcribe(audio, language, report, cancelled)
        try:
            return self._transcribe_sarvam(path, audio, language, report, cancelled)
        except SarvamError as error:
            fallback = self._transcribe(audio, language, report, cancelled)
            fallback.warnings.append(f"Sarvam AI was not used ({error}); the local speech model was used instead.")
            return fallback

    def _transcribe_sarvam(self, path, audio, language: str, report, cancelled) -> Transcription:
        settings = self.settings
        digest = hashlib.sha1(audio.tobytes())
        digest.update(f"|{language}|sarvam|{self.sarvam.model}".encode())
        cache = settings.data_dir / "transcripts" / f"{digest.hexdigest()}.json"
        try:
            cached = Transcription(**json.loads(cache.read_text(encoding="utf-8")))
            if cached.text.strip():
                report("transcribing", 1.0, "")
                return cached
        except (OSError, ValueError, TypeError):
            pass
        reply = self.sarvam.transcribe_file(path, language, report, cancelled)
        code = str(reply.get("language_code") or "")
        text = str(reply["transcript"])
        detected = "hi" if code.startswith("hi") else "en" if code.startswith("en") else script_language(text, "hi" if language == "hi" else "en")
        transcription = Transcription(text=text, language=detected, engine="sarvam", model=self.sarvam.model)
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            temporary = cache.with_suffix(".tmp")
            temporary.write_text(json.dumps(asdict(transcription), ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, cache)
        except OSError:
            pass
        return transcription

    def run_audio(self, path, language: str, progress: Progress | None = None, cancelled=None, analyze: bool = True) -> dict:
        """With analyze=False only the transcript is returned (plus the speech-to-text details in `meta`): the website reads it with its own
        rules, so no language model has to run on this machine."""
        report = banded(progress, None if analyze else BANDS_TRANSCRIPT_ONLY)
        report("decoding", 0.0, "")
        audio = decode_audio(path, self.settings.max_audio_minutes)
        report("decoding", 1.0, "")
        transcription = self._transcribe_audio(path, audio, language, report, cancelled)
        transcript = clean_transcript(transcription.text)
        meta = {"asrEngine": transcription.engine, "asrModel": transcription.model, "durationSec": round(len(audio) / SAMPLE_RATE, 1),
                "warnings": transcription.warnings}
        if not analyze:
            return {"transcript": transcript, "language": script_language(transcript, transcription.language), "durationSec": meta["durationSec"], "meta": meta, "analysis": None}
        analysis = self.analyzer.analyze(transcript, transcription.language, meta, report, cancelled)
        return {"transcript": transcript, "language": analysis["language"], "durationSec": meta["durationSec"], "meta": meta, "analysis": analysis}

    def run_text(self, text: str, language: str = "auto", progress: Progress | None = None, cancelled=None, analyze: bool = True) -> dict:
        report = banded(progress, None if analyze else BANDS_TRANSCRIPT_ONLY)
        transcript = clean_transcript(text)
        if not analyze:
            return {"transcript": transcript, "language": script_language(transcript, language if language in {"hi", "en"} else "en"), "meta": {"asrEngine": "text", "asrModel": "", "warnings": []}, "analysis": None}
        analysis = self.analyzer.analyze(transcript, language, {"asrEngine": "text", "asrModel": "", "warnings": []}, report, cancelled)
        return {"transcript": transcript, "language": analysis["language"], "analysis": analysis}
