import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { neon as createNeon } from "@neondatabase/serverless";

export type Interview = {
  id: string; name: string; initials: string; company: string; tier: "Expert" | "Public" | "Newbie";
  date: string; sentiment: number; transcript: string; language: "en" | "hi" | "mixed";
  topics: { UX: number; Pricing: number; Features: number }; keyPoints: string[]; audioName?: string;
  sourceType?: "audio" | "images" | "text"; imageNames?: string[];
  analysisEngine?: "multilingual-transformer" | "lexical-fallback";
  transcriptionStatus?: "processing" | "complete" | "interrupted";
};

const dataDir = join(process.cwd(), "data");
const dbPath = join(dataDir, "interviews.sqlite");
const csvPath = join(dataDir, "interviews.csv");
let neonClient: ReturnType<typeof createNeon> | undefined;

function database() {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, company TEXT NOT NULL,
      tier TEXT NOT NULL, date TEXT NOT NULL, sentiment REAL NOT NULL, transcript TEXT NOT NULL,
      language TEXT NOT NULL, topics_json TEXT NOT NULL, key_points_json TEXT NOT NULL, audio_name TEXT,
      transcription_status TEXT NOT NULL DEFAULT 'complete'
    )`);
  const columns = db.prepare("PRAGMA table_info(interviews)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "transcription_status")) {
    db.exec("ALTER TABLE interviews ADD COLUMN transcription_status TEXT NOT NULL DEFAULT 'complete'");
  }
  if (!columns.some((column) => column.name === "source_type")) db.exec("ALTER TABLE interviews ADD COLUMN source_type TEXT NOT NULL DEFAULT 'audio'");
  if (!columns.some((column) => column.name === "image_names_json")) db.exec("ALTER TABLE interviews ADD COLUMN image_names_json TEXT NOT NULL DEFAULT '[]'");
  if (!columns.some((column) => column.name === "analysis_engine")) db.exec("ALTER TABLE interviews ADD COLUMN analysis_engine TEXT NOT NULL DEFAULT 'lexical-fallback'");
  return db;
}

function postgres() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for persistent Vercel storage.");
  neonClient ??= createNeon(url);
  return neonClient;
}

async function initializePostgres() {
  const sql = postgres();
  await sql`CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, company TEXT NOT NULL,
    tier TEXT NOT NULL, date TEXT NOT NULL, sentiment DOUBLE PRECISION NOT NULL, transcript TEXT NOT NULL,
    language TEXT NOT NULL, topics_json TEXT NOT NULL, key_points_json TEXT NOT NULL, audio_name TEXT,
    transcription_status TEXT NOT NULL DEFAULT 'complete', source_type TEXT NOT NULL DEFAULT 'audio',
    image_names_json TEXT NOT NULL DEFAULT '[]', analysis_engine TEXT NOT NULL DEFAULT 'lexical-fallback',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'audio'`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS image_names_json TEXT NOT NULL DEFAULT '[]'`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS analysis_engine TEXT NOT NULL DEFAULT 'lexical-fallback'`;
  await sql`CREATE TABLE IF NOT EXISTS interview_csv_snapshots (id INTEGER PRIMARY KEY, contents TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  return sql;
}

function fromRow(row: Record<string, unknown>): Interview {
  return {
    id: String(row.id), name: String(row.name), initials: String(row.initials), company: String(row.company),
    tier: row.tier as Interview["tier"], date: String(row.date), sentiment: Number(row.sentiment),
    transcript: String(row.transcript), language: row.language as Interview["language"],
    topics: JSON.parse(String(row.topics_json)), keyPoints: JSON.parse(String(row.key_points_json)),
    audioName: row.audio_name == null ? undefined : String(row.audio_name),
    sourceType: (row.source_type as Interview["sourceType"]) || "audio",
    imageNames: JSON.parse(String(row.image_names_json || "[]")),
    analysisEngine: (row.analysis_engine as Interview["analysisEngine"]) || "lexical-fallback",
    transcriptionStatus: row.transcription_status as Interview["transcriptionStatus"],
  };
}

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(records: Interview[]) {
  const headers = ["id", "date", "name", "company", "tier", "language", "sentiment", "topic_ux", "topic_pricing", "topic_features", "transcript", "key_points", "audio_name", "transcription_status", "source_type", "image_names", "analysis_engine"];
  const lines = [headers.map(csvCell).join(","), ...records.map((record) => [record.id, record.date, record.name, record.company, record.tier, record.language, record.sentiment,
    record.topics.UX, record.topics.Pricing, record.topics.Features, record.transcript, JSON.stringify(record.keyPoints), record.audioName ?? "", record.transcriptionStatus ?? "complete", record.sourceType ?? "audio", JSON.stringify(record.imageNames ?? []), record.analysisEngine ?? "lexical-fallback"]
    .map(csvCell).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

function syncCsv(db: DatabaseSync) {
  const rows = db.prepare("SELECT * FROM interviews ORDER BY rowid DESC").all() as Record<string, unknown>[];
  const contents = toCsv(rows.map(fromRow));
  const temporary = `${csvPath}.tmp`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, csvPath);
}

async function syncPostgresCsv(sql: ReturnType<typeof createNeon>) {
  const rows = await sql`SELECT * FROM interviews ORDER BY created_at DESC` as Record<string, unknown>[];
  const contents = toCsv(rows.map(fromRow));
  await sql`INSERT INTO interview_csv_snapshots (id, contents, updated_at) VALUES (1, ${contents}, NOW())
    ON CONFLICT (id) DO UPDATE SET contents = EXCLUDED.contents, updated_at = NOW()`;
  return contents;
}

export async function listInterviews() {
  if (process.env.DATABASE_URL) {
    const sql = await initializePostgres();
    const rows = await sql`SELECT * FROM interviews ORDER BY created_at DESC` as Record<string, unknown>[];
    await syncPostgresCsv(sql);
    return rows.map(fromRow);
  }
  const db = database();
  try {
    syncCsv(db);
    return (db.prepare("SELECT * FROM interviews ORDER BY rowid DESC").all() as Record<string, unknown>[]).map(fromRow);
  } finally { db.close(); }
}

export async function saveInterview(record: Interview) {
  if (process.env.DATABASE_URL) {
    const sql = await initializePostgres();
    await sql`INSERT INTO interviews (id,name,initials,company,tier,date,sentiment,transcript,language,topics_json,key_points_json,audio_name,transcription_status,source_type,image_names_json,analysis_engine)
      VALUES (${record.id},${record.name},${record.initials},${record.company},${record.tier},${record.date},${record.sentiment},${record.transcript},${record.language},${JSON.stringify(record.topics)},${JSON.stringify(record.keyPoints)},${record.audioName ?? null},${record.transcriptionStatus ?? "complete"},${record.sourceType ?? "audio"},${JSON.stringify(record.imageNames ?? [])},${record.analysisEngine ?? "lexical-fallback"})`;
    await syncPostgresCsv(sql);
    return record;
  }
  const db = database();
  try {
    db.prepare(`INSERT INTO interviews (id,name,initials,company,tier,date,sentiment,transcript,language,topics_json,key_points_json,audio_name,transcription_status,source_type,image_names_json,analysis_engine)
      VALUES (@id,@name,@initials,@company,@tier,@date,@sentiment,@transcript,@language,@topics_json,@key_points_json,@audio_name,@transcription_status,@source_type,@image_names_json,@analysis_engine)`).run({
      id: record.id, name: record.name, initials: record.initials, company: record.company, tier: record.tier,
      date: record.date, sentiment: record.sentiment, transcript: record.transcript, language: record.language,
      topics_json: JSON.stringify(record.topics), key_points_json: JSON.stringify(record.keyPoints), audio_name: record.audioName ?? null,
      transcription_status: record.transcriptionStatus ?? "complete",
      source_type: record.sourceType ?? "audio", image_names_json: JSON.stringify(record.imageNames ?? []), analysis_engine: record.analysisEngine ?? "lexical-fallback",
    });
    syncCsv(db);
    return record;
  } finally { db.close(); }
}

export async function updateInterview(id: string, record: Interview) {
  if (process.env.DATABASE_URL) {
    const sql = await initializePostgres();
    const updated = await sql`UPDATE interviews SET name=${record.name}, initials=${record.initials}, company=${record.company}, tier=${record.tier}, date=${record.date}, sentiment=${record.sentiment}, transcript=${record.transcript}, language=${record.language}, topics_json=${JSON.stringify(record.topics)}, key_points_json=${JSON.stringify(record.keyPoints)}, audio_name=${record.audioName ?? null}, transcription_status=${record.transcriptionStatus ?? "complete"}, source_type=${record.sourceType ?? "audio"}, image_names_json=${JSON.stringify(record.imageNames ?? [])}, analysis_engine=${record.analysisEngine ?? "lexical-fallback"} WHERE id=${id} RETURNING id`;
    if (!Array.isArray(updated) || updated.length === 0) return null;
    await syncPostgresCsv(sql);
    return record;
  }
  const db = database();
  try {
    const result = db.prepare(`UPDATE interviews SET name=@name, initials=@initials, company=@company, tier=@tier,
      date=@date, sentiment=@sentiment, transcript=@transcript, language=@language, topics_json=@topics_json,
      key_points_json=@key_points_json, audio_name=@audio_name, transcription_status=@transcription_status, source_type=@source_type, image_names_json=@image_names_json, analysis_engine=@analysis_engine WHERE id=@id`).run({
      id: record.id, name: record.name, initials: record.initials, company: record.company, tier: record.tier,
      date: record.date, sentiment: record.sentiment, transcript: record.transcript, language: record.language,
      topics_json: JSON.stringify(record.topics), key_points_json: JSON.stringify(record.keyPoints), audio_name: record.audioName ?? null,
      transcription_status: record.transcriptionStatus ?? "complete",
      source_type: record.sourceType ?? "audio", image_names_json: JSON.stringify(record.imageNames ?? []), analysis_engine: record.analysisEngine ?? "lexical-fallback",
    });
    if (!result.changes) return null;
    syncCsv(db);
    return record;
  } finally { db.close(); }
}

export async function csvContents() {
  if (process.env.DATABASE_URL) {
    const sql = await initializePostgres();
    return syncPostgresCsv(sql);
  }
  await listInterviews();
  return readFileSync(csvPath, "utf8");
}

export function isValidInterview(value: unknown): value is Interview {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Interview>;
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.initials === "string" &&
    typeof record.company === "string" && ["Expert", "Public", "Newbie"].includes(String(record.tier)) &&
    typeof record.date === "string" && typeof record.sentiment === "number" && Number.isFinite(record.sentiment) && record.sentiment >= -1 && record.sentiment <= 1 &&
    typeof record.transcript === "string" && ["en", "hi", "mixed"].includes(String(record.language)) &&
    !!record.topics && [record.topics.UX, record.topics.Pricing, record.topics.Features].every((score) => typeof score === "number" && Number.isFinite(score) && score >= -1 && score <= 1) &&
    Array.isArray(record.keyPoints) && record.keyPoints.every((point) => typeof point === "string") &&
    (record.sourceType === undefined || ["audio", "images", "text"].includes(record.sourceType)) &&
    (record.analysisEngine === undefined || ["multilingual-transformer", "lexical-fallback"].includes(record.analysisEngine)) &&
    (record.imageNames === undefined || (Array.isArray(record.imageNames) && record.imageNames.every((name) => typeof name === "string"))) &&
    (record.transcriptionStatus === undefined || ["processing", "complete", "interrupted"].includes(record.transcriptionStatus));
}
