from __future__ import annotations

import argparse
import json
import sys

from .config import load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="trata_engine", description="Trata engine: Hindi/English speech-to-text and interview analysis.")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("serve", help="start the engine for the website (default)")
    check = commands.add_parser("selftest", help="check the setup and try the analysis on sample conversations")
    check.add_argument("--audio", help="also transcribe this audio file")
    check.add_argument("--load", action="store_true", help="also load (download on first use) the speech models")
    transcribe = commands.add_parser("transcribe", help="transcribe one audio file and print the text")
    transcribe.add_argument("file")
    transcribe.add_argument("--language", default="auto", choices=["auto", "hi", "en"])
    analyze = commands.add_parser("analyze", help="analyse a text file and print the JSON")
    analyze.add_argument("file")
    args = parser.parse_args(argv)

    settings = load_settings()
    from .pipeline import Pipeline

    pipeline = Pipeline(settings)
    command = args.command or "serve"
    if command == "serve":
        from .server import serve_forever
        serve_forever(settings, pipeline)
        return 0
    if command == "selftest":
        from .selftest import run
        return 1 if run(settings, pipeline, args.audio, args.load) else 0
    if command == "transcribe":
        result = pipeline.run_audio(args.file, args.language, lambda stage, fraction, message="": print(f"{stage} {fraction:.0%} {message}", file=sys.stderr))
        print(result["transcript"])
        return 0
    if command == "analyze":
        with open(args.file, encoding="utf-8") as handle:
            print(json.dumps(pipeline.run_text(handle.read()), ensure_ascii=False, indent=2))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
