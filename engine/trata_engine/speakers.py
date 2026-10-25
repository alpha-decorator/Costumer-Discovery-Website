"""Works out who is speaking, because the recording is one mixed-up stream.

A phone call recorded on one microphone comes out of speech-to-text as plain text with no names. The analysis needs to know
which words are the interviewer's (pitching, asking) and which are the customer's (the opinions that count), so this step
cuts the text into short numbered lines, asks the model to label them, and builds a list of turns.

Turns are kept as character offsets into the transcript ({"who": "C", "s": 0, "e": 180}), so nothing is copied or reworded.
If the model cannot label the call, `label_turns` returns None and the analysis carries on without speaker marks.
"""
from __future__ import annotations

import math
import re
from typing import Callable

from . import prompts
from .llm import LlmError, OllamaClient
from .profile import Profile

MAX_WORDS = 24            # a "line" is one sentence, or at most this many words
WINDOW = 70               # lines labelled per model call
CONTEXT = 4               # lines of the previous window shown again so the model knows who was speaking
MAX_UNITS = 900           # beyond this (about 3 hours of talk) the call is left unlabelled

_BREAK = re.compile(r"(?<=[।?!])\s+|(?<=\.)\s+(?=[A-Zऀ-ॿ])")


def split_units(text: str, max_words: int = MAX_WORDS) -> list[tuple[int, int]]:
    """Cuts `text` into (start, end) pieces: one sentence each, long sentences broken into near-equal runs of words."""
    units: list[tuple[int, int]] = []
    for paragraph in re.finditer(r"[^\n]+", text):
        base, body = paragraph.start(), paragraph.group(0)
        position = 0
        spans = []
        for match in _BREAK.finditer(body):
            spans.append((position, match.start()))
            position = match.end()
        spans.append((position, len(body)))
        for start, end in spans:
            words = [(m.start() + start, m.end() + start) for m in re.finditer(r"\S+", body[start:end])]
            if not words:
                continue
            pieces = max(1, math.ceil(len(words) / max_words))
            size = math.ceil(len(words) / pieces)
            for index in range(0, len(words), size):
                chunk = words[index:index + size]
                units.append((base + chunk[0][0], base + chunk[-1][1]))
    return units


def _apply(reply: dict, first: int, last: int, labels: list[str | None]) -> None:
    """Writes the model's ranges into `labels` (1-based line numbers first..last). Anything it skipped is filled in afterwards."""
    for item in reply.get("turns") or []:
        if not isinstance(item, dict):
            continue
        who = {"interviewer": "I", "customer": "C"}.get(item.get("who"))
        try:
            low, high = int(item.get("from")), int(item.get("to"))
        except (TypeError, ValueError):
            continue
        if who is None:
            continue
        for number in range(max(first, low), min(last, high) + 1):
            labels[number - 1] = who


def _fill(labels: list[str | None]) -> list[str]:
    """Lines the model skipped take the label of the line before them (or the one after, at the start)."""
    known = next((label for label in labels if label), None)
    if known is None:
        raise LlmError("The model did not label any line.")
    filled, previous = [], None
    for label in labels:
        previous = label or previous
        filled.append(previous or known)
    return filled


def build_turns(units: list[tuple[int, int]], labels: list[str]) -> list[dict]:
    turns: list[dict] = []
    for (start, end), who in zip(units, labels):
        if turns and turns[-1]["who"] == who:
            turns[-1]["e"] = end
        else:
            turns.append({"who": who, "s": start, "e": end})
    return turns


def label_turns(llm: OllamaClient, profile: Profile, text: str, cancelled: Callable[[], bool] | None = None,
                progress: Callable[[float], None] | None = None) -> list[dict] | None:
    """Returns the turns, or None when the call could not be labelled sensibly."""
    cancelled = cancelled or (lambda: False)
    units = split_units(text)
    if len(units) < 4 or len(units) > MAX_UNITS:
        return None
    system, schema = prompts.speaker_system_prompt(profile), prompts.speaker_schema()
    labels: list[str | None] = [None] * len(units)
    windows = list(range(0, len(units), WINDOW))
    try:
        for index, first in enumerate(windows):
            if cancelled():
                from .asr import Cancelled
                raise Cancelled()
            last = min(len(units), first + WINDOW)
            lines = [f"[{n + 1}] {text[units[n][0]:units[n][1]]}" for n in range(first, last)]
            context = [f"[{n + 1}] ({'interviewer' if labels[n] == 'I' else 'customer'}) {text[units[n][0]:units[n][1]]}"
                       for n in range(max(0, first - CONTEXT), first) if labels[n]]
            reply = llm.chat_json(system, prompts.speaker_user_prompt(lines, context), schema)
            _apply(reply, first + 1, last, labels)
            if progress:
                progress((index + 1) / len(windows))
        final = _fill(labels)
    except LlmError:
        return None
    turns = build_turns(units, final)
    spoken = {"I": 0, "C": 0}
    for turn in turns:
        spoken[turn["who"]] += len(text[turn["s"]:turn["e"]].split())
    total = sum(spoken.values()) or 1
    if spoken["C"] / total < 0.05:      # nobody answered: the labels are not believable
        return None
    return turns


def speaker_at(turns: list[dict], start: int, end: int) -> str | None:
    """Who owns the stretch start..end of the transcript: the speaker whose turns cover most of it."""
    overlap = {"I": 0, "C": 0}
    for turn in turns:
        low, high = max(start, turn["s"]), min(end, turn["e"])
        if high > low:
            overlap[turn["who"]] += high - low
    if not overlap["I"] and not overlap["C"]:
        return None
    return "I" if overlap["I"] > overlap["C"] else "C"


def turn_lines(text: str, turns: list[dict]) -> list[str]:
    lines = []
    for turn in turns:
        spoken = re.sub(r"\s+", " ", text[turn["s"]:turn["e"]]).strip()
        lines.append(prompts.SPEAKER_NAMES[turn["who"]] + ": " + spoken)
    return lines


def split_dialogue(lines: list[str], max_chars: int) -> list[str]:
    """Packs whole turns into parts of at most `max_chars`; a turn longer than that is cut and each piece keeps its speaker's name."""
    from .analyze import split_transcript

    pieces: list[str] = []
    for line in lines:
        if len(line) <= max_chars:
            pieces.append(line)
            continue
        name, _, body = line.partition(": ")
        pieces.extend(f"{name}: {part}" for part in split_transcript(body, max_chars - len(name) - 2))
    parts, current = [], ""
    for piece in pieces:
        if current and len(current) + len(piece) + 1 > max_chars:
            parts.append(current)
            current = piece
        else:
            current = f"{current}\n{piece}" if current else piece
    if current:
        parts.append(current)
    return parts
