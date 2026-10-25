"""`python -m trata_engine selftest` - checks every moving part and tests the key rule on your own machine."""
from __future__ import annotations

import importlib.util
import shutil
import sys
import time

from .config import Settings

PASS, WARN, FAIL = "  OK   ", " WARN  ", " FAIL  "

SAMPLES = {
    "only complains about accidents (no opinion on the product)": (
        "इंटरव्यूअर: आपको सड़क सुरक्षा के बारे में क्या लगता है? ग्राहक: भाई हादसे रोज़ हो रहे हैं, बहुत बुरा हाल है, हर हफ्ते हमारे इलाके में कोई न कोई मर जाता है। "
        "लोग तेज़ गाड़ी चलाते हैं और कोई नियम नहीं मानता। सड़कें भी खराब हैं और रात में कुछ दिखता नहीं। बहुत दुख की बात है, सरकार को कुछ करना चाहिए।",
        lambda score: abs(score) <= 0.25, "score should stay near 0"),
    "accidents are awful AND loves the product": (
        "Interviewer: Trata warns drivers about accident-prone spots. What do you think? Customer: Honestly accidents are horrible, I lost a cousin last year. "
        "That is exactly why I think this is a great idea. The black spot alert is brilliant, I would install it on my truck tomorrow and tell my other drivers too.",
        lambda score: score >= 0.3, "score should be clearly positive"),
    "cares about safety but will not pay": (
        "इंटरव्यूअर: यह ऐप महीने के पाँच सौ रुपये का है। ग्राहक: सड़क सुरक्षा ज़रूरी है, हादसे बहुत होते हैं, पर मुझे नहीं लगता कि इसके लिए कोई पैसे देगा। "
        "पाँच सौ रुपये बहुत ज्यादा हैं, मैं तो नहीं दूँगा, और मेरे ड्राइवर भी इस्तेमाल नहीं करेंगे। फ्री होता तो सोचता।",
        lambda score: score <= -0.1, "score should be negative"),
}


def _line(level: str, text: str) -> None:
    print(f"{level}{text}")


def run(settings: Settings, pipeline, audio: str | None = None, load: bool = False) -> int:
    failures = 0
    supported = (3, 10) <= sys.version_info[:2] <= (3, 12)
    _line(PASS if supported else FAIL, f"Python {sys.version.split()[0]}" + ("" if supported else " - torch needs Python 3.10 to 3.12; install Python 3.12 and run start-engine.bat again"))
    for module, hint in (("numpy", "pip install numpy"),):
        ok = importlib.util.find_spec(module) is not None
        failures += not ok
        _line(PASS if ok else FAIL, f"{module} installed" if ok else f"{module} missing ({hint})")
    has_av = importlib.util.find_spec("av") is not None
    has_ffmpeg = shutil.which("ffmpeg") is not None
    _line(PASS if (has_av or has_ffmpeg) else FAIL, "audio decoder: " + ", ".join(n for n, f in (("PyAV", has_av), ("ffmpeg", has_ffmpeg)) if f) if (has_av or has_ffmpeg)
          else "no audio decoder. Run: pip install av")
    failures += not (has_av or has_ffmpeg)

    status = pipeline.asr.status()
    for key, label in (("indic", "IndicConformer (Hindi)"), ("whisper", "Whisper (English / fallback)")):
        info = status[key]
        _line(PASS if info["available"] else WARN, f"{label}: {info['model']}" + ("" if info["available"] else f"  [{info['reason']}]"))
    if not status["indic"]["available"] and not status["whisper"]["available"]:
        failures += 1
        _line(FAIL, "no speech model can run. See engine/README.md step 2.")
    if load:
        for key, backend in (("indic", pipeline.asr.indic), ("whisper", pipeline.asr.whisper)):
            if status[key]["available"]:
                started = time.time()
                try:
                    backend.load()
                    _line(PASS, f"{backend.model_name} loaded in {time.time() - started:.0f}s")
                except Exception as error:
                    _line(WARN if key == "whisper" or status["whisper"]["available"] else FAIL, f"{backend.model_name} failed to load: {error}")

    llm = pipeline.llm.status()
    if not llm["ok"]:
        failures += 1
        _line(FAIL, llm["detail"])
        return failures
    _line(PASS, f"Ollama is running; analysis model: {llm['model']}  (installed: {', '.join(llm['installed'])})")
    if llm.get("small"):
        _line(WARN, llm["detail"])

    print("\nChecking that opinions about the product are scored, not the sadness of the topic (can take a minute per sample)...")
    for title, (text, check, expectation) in SAMPLES.items():
        started = time.time()
        try:
            result = pipeline.analyzer.analyze(text, "auto", {"asrEngine": "selftest", "warnings": []})
        except Exception as error:
            failures += 1
            _line(FAIL, f"{title}: {error}")
            continue
        score = result["ideaSentiment"]["score"]
        _line(PASS if check(score) else WARN,
              f"{title}: score {score:+.2f} ({result['ideaSentiment']['label']}), concern about the problem: {result['problemConcern']['level']}, "
              f"{len(result['features'])} features, {len(result['mentions'])} mentions, {time.time() - started:.0f}s" + ("" if check(score) else f"   <- expected: {expectation}"))
    if audio:
        started = time.time()
        try:
            out = pipeline.run_audio(audio, "auto")
            _line(PASS, f"transcribed {out['durationSec']}s of audio in {time.time() - started:.0f}s ({out['analysis']['meta']['asrEngine']}):")
            print("        " + out["transcript"][:400].replace("\n", " "))
        except Exception as error:
            failures += 1
            _line(FAIL, f"audio test failed: {error}")
    print("\nAll good." if not failures else f"\n{failures} problem(s) need fixing before the engine can be used.")
    return failures
