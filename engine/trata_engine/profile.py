"""The product description the model is told about. Kept in a plain JSON file so it can be edited without touching code."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PITCH = "Trata is a road-safety startup. Customers are interviewed about the Trata idea, its features and whether they would use or pay for it."


@dataclass
class Feature:
    name: str
    description: str = ""
    aka: list[str] = field(default_factory=list)


@dataclass
class Profile:
    name: str = "Trata"
    pitch: str = DEFAULT_PITCH
    features: list[Feature] = field(default_factory=list)


def load_profile(path: Path) -> Profile:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return Profile()
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read {path}: {error}")
    features = []
    for item in raw.get("features") or []:
        if isinstance(item, str):
            features.append(Feature(name=item.strip()))
        elif isinstance(item, dict) and str(item.get("name", "")).strip():
            aka = [str(a).strip() for a in item.get("aka") or [] if str(a).strip()]
            features.append(Feature(name=str(item["name"]).strip(), description=str(item.get("description", "")).strip(), aka=aka))
    return Profile(name=str(raw.get("name") or "Trata").strip() or "Trata",
                   pitch=str(raw.get("pitch") or DEFAULT_PITCH).strip(), features=features[:40])
