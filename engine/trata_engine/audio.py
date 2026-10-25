"""Decode any audio file to 16 kHz mono and cut it into short pieces at the quietest moments."""
from __future__ import annotations

import shutil
import subprocess

import numpy as np

SAMPLE_RATE = 16000
FRAME_SECONDS = 0.02


class AudioError(Exception):
    pass


def _decode_ffmpeg(path: str) -> np.ndarray:
    command = ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    try:
        done = subprocess.run(command, capture_output=True, timeout=1800)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise AudioError(f"ffmpeg failed: {error}") from error
    if done.returncode != 0:
        raise AudioError("ffmpeg could not read the file: " + done.stderr.decode("utf-8", "replace").strip()[:300])
    return np.frombuffer(done.stdout, dtype="<f4").astype(np.float32, copy=True)


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, (list, tuple)) else [value]


def _decode_av(path: str) -> np.ndarray:
    import av  # imported here so the engine still starts when PyAV is not installed

    container = av.open(path)
    try:
        stream = next((item for item in container.streams if item.type == "audio"), None)
        if stream is None:
            raise AudioError("The file has no audio track.")
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        parts = []
        for frame in container.decode(stream):
            for converted in _as_list(resampler.resample(frame)):
                parts.append(converted.to_ndarray().reshape(-1))
        for converted in _as_list(resampler.resample(None)):
            parts.append(converted.to_ndarray().reshape(-1))
    finally:
        container.close()
    return np.concatenate(parts).astype(np.float32, copy=False) if parts else np.zeros(0, dtype=np.float32)


def decode_audio(path, max_minutes: int = 180) -> np.ndarray:
    path = str(path)
    samples = None
    problems: list[str] = []
    if shutil.which("ffmpeg"):
        try:
            samples = _decode_ffmpeg(path)
        except AudioError as error:
            problems.append(str(error))
    if samples is None:
        try:
            samples = _decode_av(path)
        except ImportError:
            problems.append("PyAV is not installed (pip install av)")
        except AudioError as error:
            problems.append(str(error))
        except Exception as error:  # PyAV raises many different error types for bad files
            problems.append(f"PyAV could not read the file: {error}")
    if samples is None:
        raise AudioError("Could not decode the audio. " + "; ".join(problems))
    if samples.size == 0:
        raise AudioError("The audio file contains no sound.")
    if samples.size / SAMPLE_RATE > max_minutes * 60:
        raise AudioError(f"The recording is longer than {max_minutes} minutes.")
    return samples


def energy(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    frame = int(sample_rate * FRAME_SECONDS)
    count = len(samples) // frame
    if count == 0:
        return np.zeros(0, dtype=np.float32)
    frames = samples[: count * frame].reshape(count, frame)
    return np.sqrt((frames * frames).mean(axis=1))


def plan_chunks(samples: np.ndarray, sample_rate: int = SAMPLE_RATE, target: float = 18.0,
                max_len: float = 28.0, min_len: float = 4.0) -> list[tuple[float, float]]:
    """Return (start, end) seconds. Cuts land on the quietest moment between target-8s and max_len, so words are not split."""
    total = len(samples) / sample_rate
    if total <= 0:
        return []
    if total <= max_len:
        return [(0.0, total)]
    smooth = np.convolve(energy(samples, sample_rate), np.ones(5) / 5, mode="same")
    chunks: list[tuple[float, float]] = []
    start = 0.0
    while total - start > max_len:
        low = int((start + max(min_len, target - 8.0)) / FRAME_SECONDS)
        high = min(int((start + max_len) / FRAME_SECONDS), len(smooth))
        cut = (low + int(np.argmin(smooth[low:high]))) * FRAME_SECONDS
        cut = max(cut, start + min_len)
        chunks.append((start, cut))
        start = cut
    if total - start > 0.05:
        chunks.append((start, total))
    return chunks


def chunk_has_speech(samples: np.ndarray, chunks: list[tuple[float, float]], sample_rate: int = SAMPLE_RATE) -> list[bool]:
    """Skipping silent pieces matters: speech models invent words when they are fed silence."""
    levels = energy(samples, sample_rate)
    if levels.size == 0:
        return [False] * len(chunks)
    floor = max(0.002, 0.04 * float(np.percentile(levels, 99)))
    flags = []
    for start, end in chunks:
        part = levels[int(start / FRAME_SECONDS): int(end / FRAME_SECONDS) + 1]
        flags.append(bool(part.size and np.percentile(part, 90) > floor))
    return flags


def slice_audio(samples: np.ndarray, start: float, end: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    return samples[int(start * sample_rate): int(end * sample_rate)]
