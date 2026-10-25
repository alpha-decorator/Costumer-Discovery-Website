"""Turns the model's JSON into a trustworthy analysis.

The model is never trusted blindly: every quote is searched for in the real transcript (quotes that are not there are marked
unverified), scores are forced to agree with their labels, and anything that looks inconsistent raises a "needs review" flag.
"""
from __future__ import annotations

import difflib
import math
import re
from datetime import datetime, timezone
from typing import Callable

from . import prompts, speakers
from .config import Settings
from .llm import OllamaClient
from .profile import Profile

SCHEMA_VERSION = 1
LABEL_BANDS = {
    "strong_positive": (0.6, 1.0), "positive": (0.2, 0.8), "mixed": (-0.25, 0.25), "neutral": (-0.15, 0.15),
    "negative": (-0.8, -0.2), "strong_negative": (-1.0, -0.6), "not_discussed": (0.0, 0.0),
}
LEVEL_ORDER = {level: index for index, level in enumerate(prompts.LEVELS)}
ACCIDENT_RANK = {"unclear": 0, "none": 1, "near_miss": 2, "minor": 3, "serious": 4}
UNDERSTANDING_RANK = {"unclear": 0, "confused": 1, "partial": 2, "clear": 3}
_PUNCT = re.compile(r"[\s\.,;:!?\"'“”‘’()\[\]{}…।\-–—]+")


# ---------------------------------------------------------------- small helpers
def _number(value, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(number) or math.isinf(number) else max(-1.0, min(1.0, number))


def _enum(value, allowed: list[str], default: str) -> str:
    return value if isinstance(value, str) and value in allowed else default


def _text(value, limit: int) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def sanitize_raw(raw) -> dict:
    """Forces whatever the model sent (or what survived a cut-off) into the shapes the rest of the code expects."""
    def as_dict(value) -> dict:
        return value if isinstance(value, dict) else {}

    def as_list(value) -> list:
        return list(value) if isinstance(value, list) else []

    raw = as_dict(raw)
    attitude = as_dict(raw.get("attitude_to_product"))
    topics = as_dict(raw.get("topics"))
    customer = as_dict(raw.get("customer"))
    return {
        "summary": raw.get("summary") if isinstance(raw.get("summary"), str) else "",
        "language": raw.get("language") if isinstance(raw.get("language"), str) else "",
        "customer": {**customer, "transport": as_list(customer.get("transport"))},
        "qa": [item for item in as_list(raw.get("qa")) if isinstance(item, dict)],
        "problem_concern": as_dict(raw.get("problem_concern")),
        "attitude_to_product": {**attitude, "evidence": as_list(attitude.get("evidence"))},
        "would_use": raw.get("would_use"), "would_pay": raw.get("would_pay"),
        "topics": {key: as_dict(topics.get(key)) for key in ("ux", "pricing", "features")},
        "features": [item for item in as_list(raw.get("features")) if isinstance(item, dict)],
        "mentions": [item for item in as_list(raw.get("mentions")) if isinstance(item, dict)],
        "key_points": as_list(raw.get("key_points")),
        "alternatives": as_list(raw.get("alternatives")),
    }


def _canon(value: str) -> str:
    return _PUNCT.sub("", value.casefold())


def clean_transcript(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def split_transcript(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    parts, start = [], 0
    while len(text) - start > max_chars:
        end = start + max_chars
        floor = start + int(max_chars * 0.6)
        cut = max((text.rfind(mark, floor, end) for mark in ("।", ".", "?", "!", "\n")), default=-1)
        if cut < 0:
            cut = text.rfind(" ", floor, end)
        cut = end if cut < 0 else cut + 1
        parts.append(text[start:cut].strip())
        start = cut
    if text[start:].strip():
        parts.append(text[start:].strip())
    return parts


def label_for_score(score: float) -> str:
    if score >= 0.6:
        return "strong_positive"
    if score >= 0.2:
        return "positive"
    if score <= -0.6:
        return "strong_negative"
    if score <= -0.2:
        return "negative"
    return "neutral" if abs(score) < 0.1 else "mixed"


def reconcile_score(label: str, score: float) -> float:
    low, high = LABEL_BANDS[label]
    return round(max(low, min(high, score)), 3)


def reconcile_feature(stance: str, score: float) -> float:
    if stance == "positive" and score < 0.1:
        score = 0.3
    elif stance == "negative" and score > -0.1:
        score = -0.3
    elif stance == "request" and score < 0.1:
        score = 0.3
    elif stance == "confused":
        score = min(score, 0.0)
    elif stance == "neutral":
        score = max(-0.2, min(0.2, score))
    return round(score, 3)


_TONE_VALUE = {"positive": 0.6, "mixed": 0.1, "negative": -0.6}
_INTENT_VALUE = {"yes": 0.7, "maybe": 0.15, "no": -0.7}
SENTIMENT_GAP = 0.4          # how far the headline score may sit from the rest of the model's own answer before it is pulled back


def implied_score(qa: list[dict], features: list[dict], would_use: str, would_pay: str) -> tuple[float, float] | None:
    """What the model's OWN detailed answers (per-question tones, feature opinions, would-use, would-pay) add up to.
    Returns (score, weight) or None when there is too little detail to judge. Used to catch a headline score that
    contradicts everything else the model said, which is the typical failure of small local models."""
    values: list[tuple[float, float]] = []
    values += [(_TONE_VALUE[item["tone"]], 1.0) for item in qa if item.get("tone") in _TONE_VALUE]
    values += [(item["score"], 1.0) for item in features if item.get("stance") in {"positive", "negative", "mixed", "request"}]
    if would_use in _INTENT_VALUE:
        values.append((_INTENT_VALUE[would_use], 2.0))
    if would_pay in {"yes", "no"}:
        values.append((0.7 if would_pay == "yes" else -0.5, 1.0))
    weight = sum(w for _, w in values)
    if weight < 3:
        return None
    return sum(v * w for v, w in values) / weight, weight


def script_language(text: str, model_language: str) -> str:
    devanagari = sum(1 for ch in text if "ऀ" <= ch <= "ॿ")
    latin = sum(1 for ch in text if ("a" <= ch <= "z") or ("A" <= ch <= "Z"))
    if devanagari + latin == 0:
        return model_language if model_language in prompts.LANGUAGES else "en"
    share = devanagari / (devanagari + latin)
    if share > 0.55:
        return "hi"
    if share >= 0.08:
        return "mixed"
    return model_language if model_language in {"hi", "mixed"} else "en"


# ---------------------------------------------------------------- quote checking
def locate_span(transcript: str, quote: str) -> tuple[str, int, int] | None:
    """Find `quote` in the transcript. Returns the exact transcript text and where it starts and ends, or None."""
    quote = quote.strip(" \t\r\n\"'“”‘’«»…")
    words = quote.split()
    if len(quote) < 3 or not words:
        return None
    exact = re.search(r"\s+".join(re.escape(word) for word in words), transcript, re.I)
    if exact:
        return exact.group(0), exact.start(), exact.end()
    if len(words) < 3:
        return None
    spans = [(m.group(0), m.start(), m.end()) for m in re.finditer(r"\S+", transcript)]
    tokens = [_canon(word) for word, _, _ in spans]
    wanted = [_canon(word) for word in words]
    size = len(wanted)
    if size > len(tokens):
        return None
    wanted_set = set(wanted)
    prefix = [0]
    for token in tokens:
        prefix.append(prefix[-1] + (1 if token in wanted_set else 0))
    scored = sorted(((prefix[i + size] - prefix[i], i) for i in range(len(tokens) - size + 1)), reverse=True)[:6]
    target = " ".join(wanted)
    best, best_ratio = None, 0.0
    for hits, i in scored:
        if hits < 0.6 * size:
            break
        ratio = difflib.SequenceMatcher(None, target, " ".join(tokens[i:i + size])).ratio()
        if ratio > best_ratio:
            best, best_ratio = i, ratio
    if best is None or best_ratio < 0.72:
        return None
    start, end = spans[best][1], spans[best + size - 1][2]
    return transcript[start:end], start, end


def locate(transcript: str, quote: str) -> tuple[str, float] | None:
    """Like locate_span, but gives how far through (0-1) the quote appears instead of where it ends."""
    found = locate_span(transcript, quote)
    return None if found is None else (found[0], found[1] / max(1, len(transcript)))


def make_evidence(transcript: str, quote, turns: list[dict] | None = None) -> dict | None:
    """A quote as the website stores it. With `turns`, a quote that turns out to be the INTERVIEWER's words is refused
    (returned as {"by": "I"}) because only the customer's own words are evidence."""
    quote = _text(quote, 400)
    if not quote:
        return None
    found = locate_span(transcript, quote)
    if found:
        if turns and speakers.speaker_at(turns, found[1], found[2]) == "I":
            return {"by": "I"}
        return {"text": found[0], "pos": round(found[1] / max(1, len(transcript)), 4), "verified": True}
    return {"text": quote, "pos": None, "verified": False}


def _customer_evidence(transcript: str, quote, turns: list[dict] | None) -> dict | None:
    evidence = make_evidence(transcript, quote, turns)
    return None if evidence is None or evidence.get("by") == "I" else evidence


# ---------------------------------------------------------------- merging long transcripts
def _combine_intent(values: list[str]) -> str:
    known = {value for value in values if value in {"yes", "maybe", "no"}}
    if not known:
        return "unclear"
    return known.pop() if len(known) == 1 else "maybe"


def merge_raw(parts: list[tuple[int, dict]]) -> dict:
    parts = [(weight, sanitize_raw(raw)) for weight, raw in parts]
    if len(parts) == 1:
        return parts[0][1]
    raws = [raw for _, raw in parts]
    attitudes = [(weight, (raw.get("attitude_to_product") or {})) for weight, raw in parts]
    scored = [(weight, _number(att.get("score"))) for weight, att in attitudes
              if _enum(att.get("label"), prompts.LABELS, "not_discussed") != "not_discussed"]
    if scored:
        score = sum(w * s for w, s in scored) / sum(w for w, _ in scored)
        label = label_for_score(score)
    else:
        score, label = 0.0, "not_discussed"
    topics = {}
    for key in ("ux", "pricing", "features"):
        used = [(w, _number(((raw.get("topics") or {}).get(key) or {}).get("score"))) for w, raw in parts
                if ((raw.get("topics") or {}).get(key) or {}).get("discussed")]
        topics[key] = {"discussed": bool(used), "score": sum(w * s for w, s in used) / sum(w for w, _ in used) if used else 0.0}
    customers = [raw.get("customer") or {} for raw in raws]
    transport = []
    for customer in customers:
        for mode in customer.get("transport") or []:
            if mode in prompts.TRANSPORT and mode not in transport:
                transport.append(mode)
    levels = [_enum((raw.get("problem_concern") or {}).get("level"), prompts.LEVELS, "none") for raw in raws]
    concern_notes = [_text((raw.get("problem_concern") or {}).get("note"), 240) for raw in raws]
    return {
        "summary": " ".join(_text(raw.get("summary"), 600) for raw in raws if raw.get("summary")),
        "language": next((raw.get("language") for raw in raws if raw.get("language")), "en"),
        "customer": {
            "role": next((c.get("role") for c in customers if _enum(c.get("role"), prompts.ROLES, "unclear") != "unclear"), "unclear"),
            "transport": transport[:4],
            "accident_experience": max((_enum(c.get("accident_experience"), prompts.ACCIDENT, "unclear") for c in customers),
                                       key=lambda value: ACCIDENT_RANK[value]),
            "understood_idea": max((_enum(c.get("understood_idea"), prompts.UNDERSTANDING, "unclear") for c in customers),
                                   key=lambda value: UNDERSTANDING_RANK[value]),
        },
        "qa": [item for raw in raws for item in (raw.get("qa") or [])],
        "problem_concern": {"level": max(levels, key=lambda level: LEVEL_ORDER[level]), "note": next((n for n in concern_notes if n), "")},
        "attitude_to_product": {
            "reasoning": " ".join(_text(att.get("reasoning"), 300) for _, att in attitudes if att.get("reasoning"))[:600],
            "evidence": [q for _, att in attitudes for q in (att.get("evidence") or [])][:8],
            "label": label, "score": score,
        },
        "would_use": _combine_intent([raw.get("would_use") for raw in raws]),
        "would_pay": _combine_intent([raw.get("would_pay") for raw in raws]),
        "topics": topics,
        "features": [item for raw in raws for item in (raw.get("features") or [])],
        "mentions": [item for raw in raws for item in (raw.get("mentions") or [])],
        "key_points": [item for raw in raws for item in (raw.get("key_points") or [])],
        "alternatives": [item for raw in raws for item in (raw.get("alternatives") or [])],
    }


# ---------------------------------------------------------------- normalising the model's answer
def verdict_for(score: float, label: str, would_use: str) -> str:
    if label == "not_discussed":
        return "no_signal"
    if score >= 0.55:
        verdict = "strong_yes"
    elif score >= 0.2:
        verdict = "lean_yes"
    elif score <= -0.55:
        verdict = "strong_no"
    elif score <= -0.2:
        verdict = "lean_no"
    else:
        verdict = "undecided"
    if would_use == "no" and verdict in {"strong_yes", "lean_yes"}:
        return "undecided"
    return verdict


def _merge_features(items: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for item in items:
        key = _canon(item["name"])
        if key not in merged:
            merged[key] = {**item, "count": 1, "_scores": [item["score"]], "_stances": {item["stance"]}}
            continue
        entry = merged[key]
        entry["count"] += 1
        entry["_scores"].append(item["score"])
        entry["_stances"].add(item["stance"])
        if not (entry["evidence"] and entry["evidence"]["verified"]) and item["evidence"]:
            entry["evidence"] = item["evidence"]
        if entry["importance"] == "unclear":
            entry["importance"] = item["importance"]
    result = []
    for entry in merged.values():
        scores = entry.pop("_scores")
        stances = entry.pop("_stances")
        entry["score"] = round(sum(scores) / len(scores), 3)
        if len(stances) > 1:
            entry["stance"] = "mixed"
        result.append(entry)
    return result[:25]


def normalize_analysis(raw: dict, transcript: str, meta: dict | None = None, turns: list[dict] | None = None) -> dict:
    raw = sanitize_raw(raw)
    meta = dict(meta or {})
    attitude = raw.get("attitude_to_product") or {}
    label = _enum(attitude.get("label"), prompts.LABELS, "not_discussed")
    score = reconcile_score(label, _number(attitude.get("score")))
    idea_evidence = [e for e in (_customer_evidence(transcript, q, turns) for q in (attitude.get("evidence") or [])[:5]) if e]

    features = []
    for item in (raw.get("features") or [])[:40]:
        if not isinstance(item, dict) or not _text(item.get("name"), 60):
            continue
        stance = _enum(item.get("stance"), prompts.STANCES, "neutral")
        features.append({
            "name": _text(item.get("name"), 60), "stance": stance,
            "score": reconcile_feature(stance, _number(item.get("score"))),
            "importance": _enum(item.get("importance"), prompts.IMPORTANCE, "unclear"),
            "evidence": _customer_evidence(transcript, item.get("evidence"), turns),
        })
    features = _merge_features(features)

    mentions, seen, dropped = [], set(), 0
    for item in (raw.get("mentions") or [])[:60]:
        if not isinstance(item, dict):
            continue
        text, evidence = _text(item.get("text"), 300), make_evidence(transcript, item.get("evidence"), turns)
        kind = _enum(item.get("type"), prompts.MENTION_TYPES, "other")
        if evidence and evidence.get("by") == "I":
            continue          # the quote is the interviewer's own sentence, so this is not something the customer said
        if not text and not evidence:
            continue
        if kind == "competitor" and not (evidence and evidence.get("verified")):
            dropped += 1  # a competitor named without a quote that is really in the call is a made-up one; never show it as a finding
            continue
        text = text or (evidence["text"] if evidence else "")
        key = (kind, _canon(text))
        if key in seen:
            continue
        seen.add(key)
        mentions.append({"type": kind, "text": text, "evidence": evidence})
    mentions = mentions[:40]

    qa = []
    for item in (raw.get("qa") or [])[:16]:
        question, answer = _text(item.get("question"), 200), _text(item.get("answer"), 300)
        if not question and not answer:
            continue
        qa.append({"question": question, "answer": answer, "tone": _enum(item.get("tone"), prompts.TONES, "none"),
                   "evidence": _customer_evidence(transcript, item.get("evidence"), turns)})
    qa = qa[:12]

    person = raw.get("customer") or {}
    transport = []
    for mode in person.get("transport") or []:
        if mode in prompts.TRANSPORT and mode not in transport:
            transport.append(mode)
    profile = {"role": _enum(person.get("role"), prompts.ROLES, "unclear"), "transport": transport[:4],
               "accident": _enum(person.get("accident_experience"), prompts.ACCIDENT, "unclear"),
               "understanding": _enum(person.get("understood_idea"), prompts.UNDERSTANDING, "unclear")}

    topics = {}
    for key, name in (("ux", "UX"), ("pricing", "Pricing"), ("features", "Features")):
        topic = (raw.get("topics") or {}).get(key) or {}
        discussed = bool(topic.get("discussed"))
        topics[name] = {"discussed": discussed, "score": round(_number(topic.get("score")), 3) if discussed else 0.0}

    summary = _text(raw.get("summary"), 1200)
    key_points = [p for p in (_text(point, 240) for point in (raw.get("key_points") or [])[:12]) if p][:8] or ([summary[:240].rstrip()] if summary else [])
    would_use = _enum(raw.get("would_use"), prompts.INTENT, "unclear")
    would_pay = _enum(raw.get("would_pay"), prompts.INTENT, "unclear")
    concern = raw.get("problem_concern") or {}

    reasons = []
    implied = implied_score(qa, features, would_use, would_pay) if label != "not_discussed" else None
    if implied and abs(score - implied[0]) > SENTIMENT_GAP:
        # The headline score contradicts the model's own question-by-question and feature answers. Meet in the middle and say so.
        score = round((score + implied[0]) / 2, 3)
        label = label_for_score(score)
        reasons.append("sentiment_adjusted")
    verified_idea = any(e["verified"] for e in idea_evidence)
    verified_features = [f for f in features if f["evidence"] and f["evidence"]["verified"]]
    if label != "not_discussed" and not verified_idea and not verified_features:
        reasons.append("no_verified_evidence")
    if label != "not_discussed" and verified_features:
        feature_mean = sum(f["score"] for f in verified_features) / len(verified_features)
        if abs(score - feature_mean) > 0.6:
            reasons.append("feature_mismatch")
    if len(transcript.split()) < 40:
        reasons.append("very_short")
    if turns is None and len(transcript.split()) >= 120 and meta.get("asrEngine") != "text":
        reasons.append("no_speaker_split")
    if meta.get("warnings"):
        reasons.append("asr_warning")
    if dropped:
        reasons.append("mentions_dropped")

    meta.update({"wordCount": len(transcript.split()), "speakers": "model" if turns else "none",
                 "processedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    result = {
        "version": SCHEMA_VERSION,
        "summary": summary,
        "language": script_language(transcript, _enum(raw.get("language"), prompts.LANGUAGES, "en")),
        "ideaSentiment": {"score": score, "label": label, "reasoning": _text(attitude.get("reasoning"), 600), "evidence": idea_evidence},
        "verdict": verdict_for(score, label, would_use),
        "problemConcern": {"level": _enum(concern.get("level"), prompts.LEVELS, "none"), "note": _text(concern.get("note"), 240)},
        "wouldUse": would_use,
        "wouldPay": would_pay,
        "topics": topics,
        "features": features,
        "mentions": mentions,
        "profile": profile,
        "qa": qa,
        "keyPoints": key_points,
        "alternatives": [a for a in (_text(x, 80) for x in (raw.get("alternatives") or [])[:15]) if a][:10],
        "flags": {"needsReview": bool(reasons), "reasons": reasons},
        "meta": meta,
    }
    if turns:
        result["turns"] = [{"who": turn["who"], "s": turn["s"], "e": turn["e"]} for turn in turns]
    return result


def empty_analysis(transcript: str, meta: dict | None, reason: str) -> dict:
    return normalize_analysis({"attitude_to_product": {"label": "not_discussed", "score": 0}}, transcript, meta) | {
        "flags": {"needsReview": True, "reasons": [reason]}}


# ---------------------------------------------------------------- the analyser
Progress = Callable[[str, float, str], None]


class Analyzer:
    def __init__(self, settings: Settings, llm: OllamaClient, profile: Profile):
        self.settings = settings
        self.llm = llm
        self.profile = profile

    def analyze(self, transcript: str, language_hint: str = "auto", meta: dict | None = None,
                progress: Progress | None = None, cancelled: Callable[[], bool] | None = None) -> dict:
        from .asr import Cancelled

        progress = progress or (lambda stage, fraction, message="": None)
        cancelled = cancelled or (lambda: False)
        text = clean_transcript(transcript)
        meta = dict(meta or {})
        meta["reportLanguage"] = self.settings.report_language
        if len(text.split()) < 8:
            return empty_analysis(text, meta, "very_short")
        turns = None
        if len(text.split()) >= 60:
            progress("analyzing", 0.0, "speakers")
            turns = speakers.label_turns(self.llm, self.profile, text, cancelled, lambda fraction: progress("analyzing", 0.2 * fraction, "speakers"))
        if turns:
            parts = speakers.split_dialogue(speakers.turn_lines(text, turns), self.settings.part_chars)
        else:
            parts = split_transcript(text, self.settings.part_chars)
        system = prompts.system_prompt(self.profile, self.settings.report_language, labelled=bool(turns))
        schema = prompts.response_schema()
        raws: list[tuple[int, dict]] = []
        for index, part in enumerate(parts, 1):
            if cancelled():
                raise Cancelled()
            raws.append((len(part), self.llm.chat_json(system, prompts.user_prompt(part, language_hint, (index, len(parts)), bool(turns)), schema)))
            progress("analyzing", 0.2 + 0.8 * index / len(parts), f"{index}/{len(parts)}")
        meta["llmModel"] = self.llm.resolve_model()
        meta["parts"] = len(parts)
        cut_off = any(raw.pop("_cut_off", False) for _, raw in raws)
        result = normalize_analysis(merge_raw(raws), text, meta, turns)
        if cut_off:
            result["flags"] = {"needsReview": True, "reasons": [*result["flags"]["reasons"], "model_cut_off"]}
        if getattr(self.llm, "small", False):  # only possible when OLLAMA_MODEL names a tiny model on purpose
            result["flags"] = {"needsReview": True, "reasons": [*result["flags"]["reasons"], "small_model"]}
        return result
