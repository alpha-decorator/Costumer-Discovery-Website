# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Website (Next.js 15, React 19, TypeScript; Node 22+ because it uses the built-in `node:sqlite`):

- `pnpm install` then `pnpm dev` (http://localhost:3000), `pnpm build`, `pnpm start`
- Type check: `node_modules/.bin/tsc --noEmit -p .` (there is no lint script and no JS test runner)

Engine (Python 3.10–3.12 only, because torch does not support newer versions; run from `engine/`):

- Start the server: `engine\start-engine.bat` (Windows) or `./start-engine.sh` (macOS/Linux). The first run creates `engine/.venv` and installs `requirements.txt`.
- Setup check: `engine\start-engine.bat selftest`
- Run the whole test suite: `.venv/Scripts/python.exe -m unittest discover -s tests` (use `.venv/bin/python` on macOS/Linux)
- One test file: `.venv/Scripts/python.exe -m unittest discover -s tests -p test_sarvam.py`
- One test method: `cd engine/tests && ../.venv/Scripts/python.exe -m unittest test_sarvam.PipelineSarvamTests.test_no_key_means_no_cloud_call`. Run it from `tests/` because the test modules import `helpers` by bare name.
- The tests use fake models and fake HTTP servers; they do not need Ollama, a Sarvam key or a Hugging Face token.

## Architecture

**Two products in one repo.** The website (`src/`) is the product. The engine (`engine/`) is an optional local Python server the website calls for speech-to-text. Analysis is done by the website's rules, not by the engine.

**Analysis path (the default for every call, spoken or pasted).** `src/lib/rules/` is a regex-and-word-list analyser for Hindi, Hinglish and English. Read these together:

- `text.ts` normalises Devanagari (nukta, chandrabindu, precomposed letters) and splits the text into units while keeping offsets into the original, so every quote is a real piece of the input.
- `classify.ts` labels each unit as interviewer question (Q), interviewer pitch (P) or customer (C). Labels in the transcript and timestamp lines are used when present; otherwise it guesses from question words and "I/my" wording.
- `call-sentiment.ts` holds the opinion lexicon (praise, rejection, price, doubt) with negation and clause checks.
- `extract.ts` builds a `Doc`: opinion cues (only on C units, and only about Trata; see below), question/answer exchanges, and the product-introduction point `introAt`. It also extracts intent (would use / would pay), accident experience, transport, features, mentions and quotes.
- `analyze.ts` is the entry point (`analyzeWithRules`). It strips timestamps, refuses non-calls (no interviewer questions or pitch, or no product/accident/travel talk), scores the headline sentiment and writes the summary.
- `responder.ts` builds the responder-only report (`analysis.responder`): one entry per customer answer, with the interviewer's question only as context.

Rules that the code depends on:

- A customer remark counts toward the Trata opinion only if it names the product or idea, answers a question about use, pay or opinion of the product, or follows the pitch (`aboutTrata` in `extract.ts`). Remarks about accidents, roads or vehicles go to the concern field instead. Scoring and intent votes ignore everything before `introAt`.
- Interviewer speech is never scored. A question's wording never counts as an opinion.
- The TypeScript rules have no test runner. To check a change, run `analyzeWithRules` on a sample conversation (for example through a small script that transpiles the `.ts` files) and read the verdict, the evidence quotes and `flags.reasons`. `tsc` only checks types.

**The website's data flow.** `src/app/page.tsx` is the upload and dashboard screen. Uploads and text go through `src/lib/engine-client.ts`, whose `recordFromResult` always re-scores the transcript with the rules, whatever the engine returned. The engine's own analysis is ignored by the website on purpose, so a spoken call and the same pasted text get the same score. Saved interviews are in `src/lib/db.ts`: SQLite in `data/` locally, Postgres when `DATABASE_URL` is set. `src/app/api/*` routes check the session themselves; `src/middleware.ts` blocks signed-out access to everything except login and register. Sessions and sign-in live in `src/lib/auth/`.

**The engine (`engine/trata_engine/`).** `server.py` is a small HTTP server with a job queue (`jobs.py`). `pipeline.py` runs decode → transcribe → (optional) analyse. Speech-to-text (`asr.py`) uses IndicConformer for Hindi and faster-whisper for English, and `sarvam.py` sends the upload to Sarvam's batch API when a key is set. Sarvam is used only when `SARVAM_API_KEY` or `engine/sarvam_api_key.txt` is present and `ASR_BACKEND` is `auto` or `sarvam`; on failure, the local models run and the result carries a warning. The engine's own LLM analysis (`analyze.py`, `llm.py`, `prompts.py`, via Ollama) still exists for the command-line tools but is not used by the website. `config.py` reads all settings from environment variables.

**Audio input is paused.** `AUDIO_INPUT_ENABLED` in `src/app/page.tsx` controls the audio tab. It is false: the tab, the language select and the start button are shown but disabled. Set it to true to turn audio on.

**Things to check after a change:**

- The engine is a long-running process. After changing engine code or the key file, restart it; a stale process keeps running old code (this has happened).
- Hugging Face access for the Hindi model needs `engine/hf_token.txt` (git-ignored). Without it the engine uses Whisper for Hindi and says so in the warnings.
- Keys belong in `engine/sarvam_api_key.txt` or environment variables, never in code or in the chat.
- Speech-to-text output has timestamps (`00:01` lines) and garbled Hindi. `stripTimestamps` in `analyze.ts` removes the timestamps before analysis; the rules are tuned against that kind of noise, so expect weak evidence on poor transcripts (the report flags these with `few_opinions`).
