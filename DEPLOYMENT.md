# Vercel deployment notes

## Required persistent storage

The local development version uses SQLite and writes an export mirror to `data/interviews.csv`. For Vercel, set `DATABASE_URL` to a Postgres connection string from a Vercel Marketplace provider such as Neon. The app creates its `interviews` and `interview_csv_snapshots` tables on first API request. Interview changes are stored in Postgres, and the CSV snapshot is refreshed after writes and served by `/api/interviews/csv`.

Do not deploy without `DATABASE_URL`: Vercel function files are not durable storage, so local SQLite would not reliably preserve interviews across invocations or deployments.

## Steps

1. Import this project into Vercel or link the workspace with the Vercel CLI.
2. Add a free Postgres integration (Neon is supported) to the Vercel project.
3. Confirm the integration exposes `DATABASE_URL` to Production and Preview environments.
4. Deploy the project and verify `/api/interviews` plus `/api/interviews/csv` on the deployed domain.
5. The existing local `data/interviews.sqlite` is not copied automatically. Upload or import those records only after choosing where that customer data should be hosted.

## NLP model

New text, image OCR, and completed audio transcripts use `Horizon-Labs/multilingual-sentiment-small` through Transformers.js. It is downloaded from Hugging Face to the browser and cached there. The first model download is about 268 MB; inference is local and does not send interview text to a model API. The model is Apache-2.0. If it cannot load, the app saves a result from its local fallback analyzer and records which analyzer was used.
