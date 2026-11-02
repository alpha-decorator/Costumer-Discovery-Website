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

**The website's data flow.** Signed-in pages live in `src/app/(app)/`: `page.tsx` (dashboard), `upload/`, `customers/`, `reports/`, `business/`, `settings/`, all inside `AppShell` and `WorkspaceProvider` (which loads the interviews once and holds the filter, selection, theme and palette). Uploads and text go through `src/lib/engine-client.ts`, whose `recordFromResult` always re-scores the transcript with the rules, whatever the engine returned. The engine's own analysis is ignored by the website on purpose, so a spoken call and the same pasted text get the same score. Saved interviews are in `src/lib/db.ts`: SQLite in `data/` locally, Postgres when `DATABASE_URL` is set. `src/app/api/*` routes check the session themselves; `src/middleware.ts` blocks signed-out access to everything except login and register. Sessions and sign-in live in `src/lib/auth/`.

**The engine (`engine/trata_engine/`).** `server.py` is a small HTTP server with a job queue (`jobs.py`). `pipeline.py` runs decode → transcribe → (optional) analyse. Speech-to-text (`asr.py`) uses IndicConformer for Hindi and faster-whisper for English, and `sarvam.py` sends the upload to Sarvam's batch API when a key is set. Sarvam is used only when `SARVAM_API_KEY` or `engine/sarvam_api_key.txt` is present and `ASR_BACKEND` is `auto` or `sarvam`; on failure, the local models run and the result carries a warning. The engine's own LLM analysis (`analyze.py`, `llm.py`, `prompts.py`, via Ollama) still exists for the command-line tools but is not used by the website. `config.py` reads all settings from environment variables.

**Look and feel (themes).** Six colour themes: Royal Purple (default), Jungle, Ocean Blue, Red Lava, Graphite Rose, Neon Blue.

- `src/lib/palette.ts` lists them for the picker (`ThemePicker.tsx` in the top bar). Each has a default light/dark mode.
- A boot script in `layout.tsx` sets `html[data-palette]` before the first paint. Light/dark is `.fn-app[data-theme]`.
- Styles load in this order: `globals.css` → `dashboard.css` → `premium.css` (tokens and the shared look per palette) → `themes.css` (each theme's own fonts, shapes, sidebar and faint background art from `public/themes/*.svg`) → `insights.css` (map, demographics and edit form).
- `middleware.ts` excludes `themes/` so the art loads without a session.

**Saved theme per account.** `users.palette` and `users.theme` (added in `src/lib/users.ts`) hold each person's choice.

- `WorkspaceProvider` reads it from `GET /api/preferences` on load and saves every change with `PUT` (debounced). An account with nothing saved takes the browser's current choice.
- `POST /api/auth/login` returns `preferences`, and `AuthForm` applies them before redirecting, so a sign-in on any device opens in the person's last theme.

**Customer profile (demographics).** `src/lib/demographics.ts` defines the optional fields and their choices (English + Hindi labels): age, gender, state, area, occupation, income, education, vehicle. It also has `STATES` (with centres), `CITY_STATE`, `stateOf`, `cleanDemographics` and the validator `demographicsProblem`, which `interviewProblem` calls.

- Storage: the profile is saved as `interviews.demographics_json` (SQLite and Postgres migrations in `interviews.ts`). It is exported as CSV columns after `city`.
- Input: `DemographicsFields.tsx` is the shared input block on the upload page ("Customer profile" card) and in the customer edit form.
- City lookup: `src/lib/cities.ts` (about 80 cities with Hindi and old-name aliases, `findCity`) places a typed city. The `<datalist id="fn-cities">` lives in `AppShell`.
- Profiles never affect scoring.

**Dashboard demographics.** The "Customer demographics" card in `src/app/(app)/page.tsx` shows:

- `IndiaMap.tsx`: a plain SVG map built from `src/lib/india-outline.json` (Natural Earth 1:10m, India's point of view, public domain, simplified). It has one circle per city, or per state centre when only a state is known. Size is the count and colour is the average sentiment.
- A by-state list and an education breakdown, plus cards per profile field. `tally` and `ProfileBars` show each group's count and its average opinion.
- An earlier three.js 3D map was removed on purpose (too heavy to render and deploy). Keep the map as SVG.

**Editing a customer.** Every saved row on `/customers` has an Edit button, which opens `CustomerDetail` with `startEditing`. The form has three parts:

1. Details: name, company, tier, date.
2. Location and personal details.
3. The conversation.

If the conversation text changed, saving re-runs `analyzeNotesWithRules`, which replaces the sentiment, topics, key points and analysis. Manual score fields appear only when the conversation is unchanged. Example customers (`SAMPLE_CUSTOMERS`) are not saved, so they cannot be edited.

**Audio input is paused.** `AUDIO_INPUT_ENABLED` in `src/app/(app)/upload/page.tsx` controls the audio tab. It is false: the tab, the language select and the start button are shown but disabled. Set it to true to turn audio on.

**Things to check after a change:**

- The engine is a long-running process. After changing engine code or the key file, restart it; a stale process keeps running old code (this has happened).
- Hugging Face access for the Hindi model needs `engine/hf_token.txt` (git-ignored). Without it the engine uses Whisper for Hindi and says so in the warnings.
- Keys belong in `engine/sarvam_api_key.txt` or environment variables, never in code or in the chat.
- Speech-to-text output has timestamps (`00:01` lines) and garbled Hindi. `stripTimestamps` in `analyze.ts` removes the timestamps before analysis; the rules are tuned against that kind of noise, so expect weak evidence on poor transcripts (the report flags these with `few_opinions`).
- Checking the UI without a browser extension: headless Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe --headless=new --screenshot=…`). For signed-in pages, drive Edge over the DevTools protocol with a session cookie from a throwaway account. Before creating one, make sure `DATABASE_URL` is not set and that at least one account already exists: the very first account adopts all ownerless interviews. Delete the test account afterwards, and remove its rows from `data/interviews.csv` too if you delete them straight from the database. In Git Bash, set `MSYS_NO_PATHCONV=1` or arguments like `/` turn into Windows paths.

## The `uiux ideas/` folder

Design references the owner collected. It is not part of the website and is **not committed**.

- `idea.txt`: was used for links to Dribbble shots the owner liked (glossy, premium dashboards). It is empty now.
- `download`: a browser network recording (HAR) of a Dribbble session, which listed the shots' image URLs. HAR files can contain cookies and session tokens, so never commit or share it.

What came from these references: rounded cards, soft gradient KPI tiles, a dark sidebar per theme, the segmented tier filter, and the six themed looks. A later "professional/minimal" restyle was tried and reverted at the owner's request. The owner prefers the themed design in `premium.css` and `themes.css`.

## Project history (what has been built, in order)

1. **Fieldnotes base** (`6caa092`, `ab5daa7`): upload of typed or pasted notes, `.txt` transcripts and photos of notes (OCR in the browser with tesseract.js). Audio goes through the local engine and is paused. The rules analyser covers Hindi, Hinglish and English. There are separate pages for dashboard, customers, reports and settings, shared business workspaces with a business code, and a PDF/report export.
2. **Deployment fixes** (`ede9a12`, `fbfb33d`, and this branch): the Python engine is excluded from the Vercel build. `AUTH_SECRET` is checked before sign-up, password sign-in and Google sign-in. SQLite on Vercel without `DATABASE_URL` fails with a clear message.
3. **Google sign-in**: the code exists (`src/lib/auth/google.ts`, `/api/auth/google`) and needs only `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. The owner paused setting it up; the button stays hidden until it is configured.
4. **Themes** (branch `themes-demographics`): six themed designs, a theme picker, and the theme saved per account.
5. **Customer demographics** (same branch): profile fields at upload, the simple India map, and demographic breakdowns on the dashboard.
6. **Customer editing** (same branch): an Edit button on each row; details, location, profile and conversation can be edited, and the conversation is re-scored on save.
