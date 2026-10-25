# Fieldnotes — customer discovery

A calm workspace for turning customer interviews (audio, images or written notes) into sentiment, topics and customer-specific points. With the optional **Trata engine** (see below) it also transcribes Hindi/English audio with the best free models, judges what each customer thinks of *Trata* specifically, and gives every customer a detailed report with charts. Available in **English and Hindi (हिंदी)**, with **free sign-in using Google or email + password**.

## Run it locally

```bash
pnpm install
cp .env.example .env.local   # optional for local use; see DEPLOYMENT.md
pnpm dev
```

**Working as a team:** open **Business code** in the sidebar (or choose **Create a business code** on the Register page) to create a code for your organization; colleagues choose **Institution** on the login page, enter the code with their own email and password, and see the same customers and dashboard. Other organizations cannot see them (details in [DEPLOYMENT.md](DEPLOYMENT.md#business-codes-one-shared-workspace-per-organization)).

Open <http://localhost:3000>, create an account (or use Google sign-in once you have added the Google credentials), and add your first interview. Use the EN / हि switch at the top to change language.

Data is stored in a local SQLite file under `data/` (Node 22+ is required for the built-in `node:sqlite`). For hosting on Vercel, see [DEPLOYMENT.md](DEPLOYMENT.md): you need a free Postgres `DATABASE_URL` and an `AUTH_SECRET`, and optionally the Google credentials.

## High-accuracy audio and the Trata report (optional, free)

The `engine/` folder is a small program you run on your own computer. It transcribes interviews with **AI4Bharat IndicConformer** (Hindi) and **Whisper large-v3-turbo** (English), and nothing else: the **website itself reads every conversation with built-in rules** (`src/lib/rules/`, regular expressions and word lists for Hindi, Hinglish and English; no model, no download, no other server). The rules judge the customer's opinion of *Trata* (not how sad road accidents are), whether they would use or pay, accidents and what they observed, features, objections, prices and other specific things they said, and flag anything that needs a human check. 500 interviews of 10 minutes cost nothing; they only take time. Setup is in [engine/README.md](engine/README.md) (Python, Ollama, then double-click `engine\start-engine.bat`).

With the engine running, the upload window accepts many audio files at once. Click any customer to open their report: verdict gauge, topic radar against the group average, per-feature bars, a map of where in the conversation each opinion came up, every specific mention with its exact quote, and the highlighted transcript. **Print / Save as PDF** exports it. The Reports tab adds a feature scoreboard and a filterable list of everything customers specifically said. All data is stored in the database and in `data/interviews.csv` (also available from Settings), including the analysis columns.

The engine runs on your computer, so a site hosted on Vercel cannot reach it; there the in-browser model is used. Run the website locally (or host both on one machine) to use the engine.

