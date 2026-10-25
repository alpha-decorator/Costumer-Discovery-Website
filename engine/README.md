# Trata engine

The engine is a small program that runs on **your own computer** next to the website. It does the heavy work, for free and with no limits:

| Job | Model | Why |
| --- | --- | --- |
| Hindi / Hinglish speech to text | **AI4Bharat IndicConformer 600M** (MIT licence) | Most accurate free model for Hindi in public benchmarks (about 8-14% word errors; Whisper-class models are far behind on Hindi) |
| Speech to text, cloud (when a Sarvam key is set) | **Sarvam AI** `saaras:v4` batch API | Strong Hindi and Hinglish; **the audio is uploaded to Sarvam**. Falls back to the local models if Sarvam fails |
| English speech to text, language detection, fallback | **Whisper large-v3-turbo** via faster-whisper | Strong English; used automatically if the Hindi model is missing |
| Understanding the conversation (optional) | The website does this itself with built-in rules, so **Ollama is not needed**. The engine can still do it with **Gemma 4** (Apache 2.0) through **Ollama**; any other installed Ollama model also works | Reads Hindi, English and Hinglish; judges what customers think of *Trata* and extracts the specific things they say |

**Where the audio goes:** without a Sarvam key, audio never leaves your computer. With a key in `engine\sarvam_api_key.txt` (or `SARVAM_API_KEY`), each recording is **uploaded to Sarvam AI's cloud** for transcription; the transcript comes back and the analysis still runs here. Sarvam's pricing and free-tier credits apply to your account. Without the key, nothing is sent anywhere.

## One-time setup (Windows)

1. Install **Python 3.12** from python.org (tick "Add python.exe to PATH"). Use 3.10, 3.11 or 3.12: newer versions (3.13 and up) have no torch yet and the install fails with "No matching distribution found for torch". You can keep a newer Python installed too; `start-engine.bat` picks a supported one by itself and rebuilds an old `.venv` made with the wrong version.
2. *(Optional, the website no longer needs it.)* Install **Ollama** (ollama.com) and download an analysis model. In a terminal: `ollama pull gemma4:e4b` (about 5 GB, runs on most laptops). With 16 GB RAM or a GPU use `ollama pull gemma4:12b` for better quality.
   Models under about 2 GB (`tinyllama`, `qwen2.5:0.5b`, `llama3.2:1b` ...) are **ignored on purpose**: they cannot follow the instructions and make things up (customers, quotes, competitors, even Spanish text). If only such a model is installed the website says "no usable analysis model".
3. **Unlock the Hindi speech model (free, once).** IndicConformer sits behind a Hugging Face licence. Without this step the engine silently uses Whisper for Hindi, which is clearly worse. (a) Make a free account at huggingface.co. (b) Open https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual and press **Agree and access repository**. (c) Open https://huggingface.co/settings/tokens, create a token of type **Read**, and paste it as the only line of a new file **`engine\hf_token.txt`** (it is git-ignored). (d) Restart the engine. `start-engine.bat selftest` shows whether the Hindi model is active; the website also shows a note while it is not.
4. Double-click **`engine\start-engine.bat`**. The first run installs the packages and downloads the speech models (roughly 3 GB, once). When you see `Trata engine ... listening`, leave that window open.
5. Check everything: `engine\start-engine.bat selftest`. It tests the speech models, Ollama, and three sample conversations. One checks that a customer who only complains about accidents is **not** scored negative on Trata, and another that a customer who cares about safety but will not pay **is**.
6. Start the website as usual (`pnpm dev`). The upload window shows "High-accuracy engine connected". If the engine is off, the website falls back to the older in-browser model.

## Tell it about Trata

Open **`engine/trata-profile.json`** (it already contains the pitch and features described in your first call: automatic crash detection, severity, ambulance, nearby cab drivers, family alert with live location, hospital details, vehicle sensors, app, pricing model; please correct anything that is wrong) and fill in a short description and Trata's features (names, a one-line description, and other words customers use, in English or Hindi). The analysis then names features the same way every time. Leave `features` empty and it still picks up any feature a customer mentions.

## How sentiment is judged

The model is told this is a **phone call between two people** (the Trata team and a possible customer), mostly in Hindi mixed with English, transcribed with mistakes. It is asked how the customer feels about **Trata** (idea, features, price, whether they would use, pay or recommend it), not how sad the subject is. Worry about accidents is recorded separately as "concern about the problem" and never changes the score.

Calibration rules in the prompt (`engine/trata_engine/prompts.py`): "it can be very useful, but how will it work?" is positive with conditions, not a rejection; questions, practical worries and advice on how to build or price Trata are engagement; a price remark about one kind of customer ("a bike rider will not pay") goes under pricing and barely moves the overall score; only a clear "not useful / will not work / would not use / not worth it" is negative; garbled words are never read as negative.

**Safety check:** after the model answers, the engine compares the headline score with the model's own detail (the tone of each question and answer, the stance on each feature, would-use, would-pay). If they disagree by more than 0.4 (for example label "negative" while every tone and feature is positive), the score is moved halfway toward the detail and the result is marked **needs review** with the reason "sentiment_adjusted". Every quote is checked against the real transcript; quotes the model invented are marked "unverified", and conversations with weak evidence or conflicting signals are flagged **needs review**.

## How a call is understood

A call is recorded on one microphone, so the text has no speaker names. The analysis therefore runs in two steps:

1. **Who is speaking.** The text is cut into short numbered lines and the model labels each as interviewer or customer. The result is stored as turns, and the report shows the transcript as a two-sided conversation.
2. **What the customer thinks.** The model reads the labelled dialogue knowing it is a Trata business call: every reply to the pitch is about Trata even when the name is not said, each answer is read together with the question before it, and the interviewer's own words are never used as a quote (any quote that turns out to be the interviewer's is dropped).

From the dialogue it also records who the customer is (role, how they travel, accident experience, whether they understood the idea) and a short list of the questions asked and the answers given. The group view uses these for charts such as "how many customers drive a car". If the model cannot split the call, the analysis still runs on the plain text and the report says so (**needs review**).

## Speed (estimates, not measurements)

Per 10-minute interview: speech to text 1-3 min on a GPU, 5-10 min on a CPU; analysis 1-3 min (it now makes two model calls: speakers, then opinions). About **3-6 hours for 500 interviews with an NVIDIA GPU, 1-2 days on a CPU-only laptop**. Jobs run one at a time, and finished results are kept for 7 days, so closing the browser does not lose work: choose the same files again and finished ones are returned instantly.

## Settings (environment variables, all optional)

`OLLAMA_MODEL` (default: best installed model under `OLLAMA_MAX_GB`=10) · `ASR_BACKEND` auto/sarvam/indic/whisper (auto uses Sarvam when a key is set) · `SARVAM_API_KEY` · `SARVAM_MODEL` saaras:v4 · `INDIC_DECODER` ctc (default) or rnnt · `WHISPER_MODEL` · `ENGINE_DEVICE` auto/cpu/cuda · `REPORT_LANGUAGE` en/hi (language of summaries) · `ENGINE_PORT` · `ENGINE_TOKEN` (shared secret; set the same value in the website's `.env.local`) · `INDIC_REVISION` (pin the model code to a commit) · `HF_TOKEN` (Hugging Face token; or put it in `engine/hf_token.txt`).

The Hindi model is loaded with `trust_remote_code`, i.e. it runs a small Python file from AI4Bharat's Hugging Face repository. Pin `INDIC_REVISION` once you are happy with it.

## Command line

`python -m trata_engine transcribe file.mp3` · `python -m trata_engine analyze notes.txt` · `python -m trata_engine selftest --audio file.mp3 --load`

## Development

`python -m unittest discover -s engine/tests` (standard library only; uses fake models).

## Language and made-up results

Calls are Hindi (with English words) or English. Language detection listens to the start, middle and end of the recording and only chooses between those two (Urdu counts as Hindi), so a noisy line can no longer be labelled French or Welsh. Whisper text that looks invented on silence (web addresses, "subtitles by ...", looping words) is dropped. Any **competitor** the analysis model reports must be backed by a quote that is really in the transcript; otherwise it is removed and the result is marked "needs review". The cross-customer board on the website shows only quote-backed mentions.


## Transcript-only jobs

The website submits jobs with `analyze=0`: the engine returns only the transcript and speech-to-text details (`analysis: null`), and the website analyses it with its own rules. No language model is loaded or called. Jobs without that flag still run the full Ollama analysis (used by the command-line tools).
