/** Browser-side helpers for the Trata engine. Every call goes through the website's own /api/engine routes (which check the login). */
import type { Interview } from "./interviews";
import { analyzeNotesWithRules } from "./nlp-analysis";
import { clampAnalysis, type TrataAnalysis } from "./trata";

export type EngineHealth = { online: boolean; indic?: boolean; whisper?: boolean; llm?: boolean; llmModel?: string | null; llmDetail?: string; llmSmall?: boolean; indicReason?: string; busy?: number; reason?: string };
/** `analysis` is null for transcript-only jobs (the default): the website reads the transcript with its own rules. `meta` holds the speech-to-text details. */
export type EngineResult = { transcript: string; language: "hi" | "en" | "mixed"; durationSec?: number; meta?: TrataAnalysis["meta"]; analysis: TrataAnalysis | null };
export type EngineJob = {
  id: string; status: "queued" | "running" | "done" | "error" | "cancelled"; stage: string; progress: number; message: string;
  queuePosition: number; elapsedSec: number; result?: EngineResult; error?: string; reused?: boolean;
};
export type EngineLanguage = "auto" | "hi" | "en";

export class EngineError extends Error {
  constructor(message: string, readonly code = "engine_error") { super(message); }
}

async function readJob(response: Response): Promise<EngineJob> {
  const body = await response.json().catch(() => ({})) as Partial<EngineJob> & { error?: string };
  if (response.status === 401) throw new EngineError("unauthorized", "unauthorized");
  if (response.status === 503) throw new EngineError("The engine is not running.", "engine_offline");
  if (!response.ok || !body.id) throw new EngineError(body.error ?? "engine_error", body.error ?? "engine_error");
  return body as EngineJob;
}

export async function getEngineHealth(): Promise<EngineHealth> {
  try {
    const response = await fetch("/api/engine/health", { cache: "no-store" });
    return response.ok ? await response.json() as EngineHealth : { online: false };
  } catch { return { online: false }; }
}

/** Same file picked again later (even after closing the browser) gets the same key, so the engine can return the saved result. */
export const jobKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

export async function startAudioJob(file: File, options: { language: EngineLanguage; signal?: AbortSignal; analyze?: boolean }): Promise<EngineJob> {
  // The engine only turns speech into text. The analysis is done by the website's built-in rules, so no language model is needed.
  const query = new URLSearchParams({ kind: "audio", language: options.language, filename: file.name, client_key: jobKey(file), analyze: options.analyze ? "1" : "0" });
  const response = await fetch(`/api/engine/jobs?${query}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" }, signal: options.signal });
  return readJob(response);
}

export async function startTextJob(text: string, options: { language?: EngineLanguage; signal?: AbortSignal } = {}): Promise<EngineJob> {
  const query = new URLSearchParams({ kind: "text", language: options.language ?? "auto" });
  const response = await fetch(`/api/engine/jobs?${query}`, { method: "POST", body: JSON.stringify({ text }), headers: { "Content-Type": "application/json" }, signal: options.signal });
  return readJob(response);
}

export async function cancelJob(id: string) {
  await fetch(`/api/engine/jobs/${id}`, { method: "DELETE" }).catch(() => undefined);
}

/**
 * Polls until the job finishes. A few failed polls in a row are tolerated (the engine keeps working while the network blips);
 * after `maxMisses` it gives up with an "engine_offline" error.
 */
export async function waitForJob(id: string, onUpdate: (job: EngineJob) => void, options: { signal?: AbortSignal; intervalMs?: number; maxMisses?: number } = {}): Promise<EngineJob> {
  const { signal, intervalMs = 1500, maxMisses = 6 } = options;
  let misses = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const response = await fetch(`/api/engine/jobs/${id}`, { cache: "no-store", signal });
      const job = await readJob(response);
      misses = 0;
      onUpdate(job);
      if (job.status === "done") return job;
      if (job.status === "error") throw new EngineError(job.error ?? "engine_error", "job_failed");
      if (job.status === "cancelled") throw new EngineError("Cancelled.", "cancelled");
    } catch (error) {
      if (error instanceof EngineError && (error.code === "job_failed" || error.code === "cancelled" || error.code === "unauthorized")) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (++misses >= maxMisses) throw new EngineError("The engine stopped responding.", "engine_offline");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

export const initialsOf = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";

/** Filenames like "ramesh_kumar-transport.mp3" become a readable default customer name. */
export const nameFromFile = (filename: string) => filename.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

export function recordFromResult(result: EngineResult, fields: Pick<Interview, "id" | "name" | "company" | "tier" | "date"> & { audioName?: string; sourceType: "audio" | "text" | "images"; imageNames?: string[] }, lang: "en" | "hi" = "en"): Interview {
  // Always the website's own rules, whatever the engine returned: a language model's answer (or a stale engine's) must not
  // change the score, so the same transcript gets the same score whether it was spoken or pasted.
  const read = analyzeNotesWithRules(result.transcript, { lang, meta: { ...result.meta, durationSec: result.durationSec ?? result.meta?.durationSec } });
  return {
    id: fields.id, name: fields.name, initials: initialsOf(fields.name), company: fields.company, tier: fields.tier, date: fields.date,
    sentiment: read.sentiment, transcript: result.transcript, language: read.language, topics: read.topics, keyPoints: read.keyPoints,
    audioName: fields.audioName, sourceType: fields.sourceType, imageNames: fields.imageNames,
    analysisEngine: read.analysisEngine, transcriptionStatus: "complete", analysis: clampAnalysis(read.analysis),
  };
}
