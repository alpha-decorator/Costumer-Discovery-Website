# Deployment notes

## Environment variables

| Variable | Needed | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Production | Postgres connection string (Neon via the Vercel Marketplace is free). Without it the app uses local SQLite in `data/`, which is not durable on Vercel. |
| `AUTH_SECRET` | Production | Random string of at least 32 characters that signs the session cookie. Generate with `openssl rand -base64 48`. Changing it signs everyone out. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional | Turn on the "Continue with Google" button. Without them, email + password sign-in still works. |
| `AUTH_URL` | Optional | Public address of the site (for example `https://fieldnotes.example.com`). Only needed if a proxy hides the real address. |
| `ENGINE_URL`, `ENGINE_TOKEN` | Optional | Where the Trata engine runs (default `http://127.0.0.1:8765`) and its shared secret, if one is set. See [engine/README.md](engine/README.md). Without a reachable engine the website uses the in-browser model. |

A template is in `.env.example`. For local development copy it to `.env.local`; the app runs without any of these (SQLite + a development-only signing key), but never run production without `AUTH_SECRET`.

## Required persistent storage

The local development version uses SQLite (`data/interviews.sqlite`). For Vercel, set `DATABASE_URL` to a Postgres connection string from a Vercel Marketplace provider such as Neon. The app creates its `users` and `interviews` tables on first use and adds the `user_id` column to an existing `interviews` table automatically.

Do not deploy without `DATABASE_URL`: Vercel function files are not durable storage, so local SQLite would not reliably preserve interviews or accounts across invocations or deployments.

## Sign-in

* **Email + password** works out of the box and is free. Passwords are stored as scrypt hashes; 5 wrong attempts lock an account for 10 minutes.
* **Google** uses the standard OAuth 2.0 authorization-code flow with PKCE. Set it up once:
  1. Open Google Cloud Console, create (or pick) a project, then **APIs & Services → OAuth consent screen** and fill in the app name and your support email. User type "External" is free; leave it in "Testing" and add your own Gmail address under *Test users*, or publish it so anyone with a Google account can sign in.
  2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
  3. Under **Authorized redirect URIs** add `https://<your-domain>/api/auth/google/callback` and, for local work, `http://localhost:3000/api/auth/google/callback`.
  4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Vercel → Project → Settings → Environment Variables) and redeploy.
* Google only requires the `openid email profile` scopes, and the account's email must be verified by Google.
* Vercel preview deployments get a different address on every deploy. Google rejects redirect addresses that are not registered, so use Google sign-in on the production domain (email + password works on previews).

### Things to know

* Email addresses typed at registration are **not verified** (there is no email service in the free setup), and there is **no "forgot password" flow**. If someone signs in with Google using an email that was first registered with a password, the account is linked to Google and the old password is removed, so nobody can pre-register someone else's address and keep access.
* Everything except `/login` and `/register` requires a session. API calls without one return `401`.

## Per-user data

Every interview belongs to the account that created it (or to the organization it works in, see below), and the list, edit, delete and CSV export endpoints only return the rows of the open workspace. Interviews saved before accounts existed have no owner; the **first account created** adopts them. `/api/interviews/csv` builds the CSV from the signed-in user's rows.

In local development the app also keeps writing a mirror of **all** interviews to `data/interviews.csv`. That file contains real interview text, so `data/*.csv` is git-ignored; do not commit it to a public repository.

## Business codes (one shared workspace per organization)

A team that runs one survey together can share a single set of customers and one dashboard:

* **Creating the code.** Two ways: on the **Register** page choose **Create a business code** (the account becomes the owner and a code such as `K7QD-M2XF` is generated at once), or, when already signed in, open **Business code** in the sidebar and press **Create business code**. The business name is optional (it defaults to “<first name>'s team”); you can type your own code instead (6–24 letters, digits or hyphens) and move your existing interviews into the shared workspace. The page then shows the code with a **Copy** button.
* Colleagues can choose **Join my business** on the Register page and type the code, or create their own account as usual and then sign in with the **Institution** tab on the login page (business code + their own email and password, or Google). Anyone who is already signed in can instead paste the code under **Business code → Join**. Everyone in the organization then sees the same customers, reports and CSV; people outside it see nothing.
* Each person still has a personal workspace. A member can switch between the two from the same screen. Signing in with the **Personal** tab opens the personal one.
* Only the owner can change the code, rename the organization or remove a member (removed people lose access immediately, because every request re-checks membership). Changing the code does not remove existing members; it only stops the old code from working for new people. A person belongs to one organization at a time.
* Interviews of an organization are stored under the owner key `org:<organization id>` in the same table, so the per-account isolation described above still holds. Deleting a customer (the **Delete** button in the table or in the customer's window) removes it for the whole organization.
* The code is a shared secret: a code alone never signs anyone in (an account and its password are always needed), wrong codes count towards the same lock-out as wrong passwords, and the code-guessing limiter is kept in memory (on serverless hosting each instance counts separately, so keep codes long and random).

## Languages

The interface is available in English and Hindi (हिंदी). The first visit follows the browser's `Accept-Language`, and the EN/हि switch remembers the choice in a cookie (`fieldnotes-lang`). Fonts (DM Sans, Manrope, Noto Sans Devanagari) load from Google Fonts. Interview transcripts, OCR (English + Hindi) and speech recognition already handled both languages and are unchanged.

## Steps

1. Import this project into Vercel or link the workspace with the Vercel CLI.
2. Add a free Postgres integration (Neon is supported) to the Vercel project and confirm it exposes `DATABASE_URL` to Production (and Preview, if you use previews).
3. Add `AUTH_SECRET` (and the Google variables if you want Google sign-in) to the Production environment.
4. Deploy, open the site, create the first account, and check `/api/interviews` and `/api/interviews/csv` while signed in.
5. The existing local `data/interviews.sqlite` is not copied automatically. Upload or import those records only after choosing where that customer data should be hosted.

## NLP model

New text, image OCR and audio transcripts are analysed by rules (`src/lib/rules/`): regular expressions and word lists for Hindi, Hinglish and English, run in the browser. There is no model to download or host, nothing is sent to a model API, and it works on Vercel as is. Each result is stamped `trata-rules v1`. Speech to text is the only part that needs a model (Whisper in the browser, or the engine on a computer).

## Trata engine

The engine (`engine/`) needs a computer with Python (a GPU makes it faster; Ollama is no longer needed because the website analyses transcripts itself), so it is not deployed to Vercel. The website talks to it only from the server (`/api/engine/*`, login required); browsers never contact it directly. Audio files up to 600 MB are streamed through to the engine, not stored by the website.

- Local use: run the engine and `pnpm dev` on the same computer; nothing else to configure.
- Website elsewhere, engine on your computer: the engine would have to be reachable from the website's server (for example over a private network or tunnel). Set `ENGINE_HOST` (it then refuses to start without `ENGINE_TOKEN`), and set the same `ENGINE_TOKEN` and `ENGINE_URL` in the website's environment. Do not expose the engine to the internet without the token.
- The analysis of each interview is saved in the `analysis_json` column (added automatically) and flattened into extra CSV columns: idea_label, verdict, would_use, would_pay, problem_concern, needs_review, review_reasons, summary, features, specific_mentions, asr_engine, asr_model, llm_model, duration_sec, analysis_json. The CSV starts with a UTF-8 marker so Excel shows Hindi correctly, and text that starts like a spreadsheet formula gets a leading apostrophe.
