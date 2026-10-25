/**
 * The shape of an analysis produced by the Trata engine (engine/trata_engine/analyze.py), plus validation and the
 * flattening used for the CSV. Pure TypeScript: it is imported by both the server and the browser.
 */
export const SENTIMENT_LABELS = ["strong_positive", "positive", "mixed", "neutral", "negative", "strong_negative", "not_discussed"] as const;
export const VERDICTS = ["strong_yes", "lean_yes", "undecided", "lean_no", "strong_no", "no_signal"] as const;
export const STANCES = ["positive", "negative", "neutral", "mixed", "request", "confused"] as const;
export const IMPORTANCE = ["must_have", "nice_to_have", "unclear"] as const;
export const MENTION_TYPES = ["feature_request", "objection", "pricing", "competitor", "use_case", "pain_point", "privacy_concern", "suggestion", "promise", "other"] as const;
export const LEVELS = ["none", "low", "medium", "high"] as const;
export const INTENTS = ["yes", "maybe", "no", "unclear"] as const;
export const TRANSPORT = ["car", "two_wheeler", "commercial_vehicle", "bus", "auto_rickshaw", "cab_taxi", "bicycle", "walks", "public_transport", "other"] as const;
export const ROLES = ["private_driver", "professional_driver", "fleet_owner", "passenger", "safety_professional", "other", "unclear"] as const;
export const ACCIDENTS = ["none", "near_miss", "minor", "serious", "unclear"] as const;
export const UNDERSTANDING = ["clear", "partial", "confused", "unclear"] as const;
export const TONES = ["positive", "negative", "mixed", "neutral", "none"] as const;

export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];
export type Verdict = (typeof VERDICTS)[number];
export type Stance = (typeof STANCES)[number];
export type Importance = (typeof IMPORTANCE)[number];
export type MentionType = (typeof MENTION_TYPES)[number];
export type Level = (typeof LEVELS)[number];
export type Intent = (typeof INTENTS)[number];
export type Transport = (typeof TRANSPORT)[number];
export type Role = (typeof ROLES)[number];
export type AccidentExperience = (typeof ACCIDENTS)[number];
export type Understanding = (typeof UNDERSTANDING)[number];
export type Tone = (typeof TONES)[number];

/** A quote from the transcript. `pos` is how far through the conversation it appears (0-1); unverified quotes have no position. */
export type Evidence = { text: string; pos: number | null; verified: boolean };
export type Topic = { discussed: boolean; score: number };
export type FeatureOpinion = { name: string; stance: Stance; score: number; importance: Importance; evidence: Evidence | null; count?: number };
export type Mention = { type: MentionType; text: string; evidence: Evidence | null };
/** Who the customer is, as they described themselves. Drives the "how many drive a car" style charts. */
export type CustomerProfile = { role: Role; transport: Transport[]; accident: AccidentExperience; understanding: Understanding };
/** One question the interviewer asked and what the customer answered. */
export type QaItem = { question: string; answer: string; tone: Tone; evidence: Evidence | null };
/** A stretch of the transcript (character offsets) spoken by the interviewer (I) or the customer (C). */
export type Turn = { who: "I" | "C"; s: number; e: number };

/**
 * The responder-only report. Only the customer's own answers are read; the interviewer's words serve only as the question each
 * answer replies to. Field names follow the agreed JSON schema.
 */
export type ResponderInteraction = { interviewer_context: string; responder_sentiment: string; responder_insight: string; unique_points_or_entities: string[] };
export type ResponderReport = { interview_summary: { overall_responder_sentiment: string; overall_customer_insight: string }; extracted_interactions: ResponderInteraction[] };

export type TrataAnalysis = {
  version: number;
  summary: string;
  language: "hi" | "en" | "mixed";
  /** How the customer feels about the Trata idea itself, never about accidents in general. */
  ideaSentiment: { score: number; label: SentimentLabel; reasoning: string; evidence: Evidence[] };
  verdict: Verdict;
  /** How much they care about the road-safety problem. Kept apart so it cannot leak into the sentiment. */
  problemConcern: { level: Level; note: string };
  wouldUse: Intent;
  wouldPay: Intent;
  topics: { UX: Topic; Pricing: Topic; Features: Topic };
  features: FeatureOpinion[];
  mentions: Mention[];
  /** Added by engine result version 3; older saved interviews do not have these. */
  profile?: CustomerProfile;
  /** Responder-only extraction (see ResponderReport). Built by the website's rules; absent on older saved interviews. */
  responder?: ResponderReport;
  qa?: QaItem[];
  turns?: Turn[];
  keyPoints: string[];
  alternatives: string[];
  flags: { needsReview: boolean; reasons: string[] };
  meta: { asrEngine?: string; asrModel?: string; llmModel?: string; durationSec?: number; wordCount?: number; processedAt?: string; reportLanguage?: string; warnings?: string[]; parts?: number; speakers?: "model" | "none" | "rules" };
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends readonly string[]>(list: T, value: unknown): value is T[number] => typeof value === "string" && (list as readonly string[]).includes(value);
const isScore = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
const isText = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
const isList = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;

function evidenceProblem(value: unknown, path: string, allowNull: boolean): string | null {
  if (value === null) return allowNull ? null : `${path} is missing`;
  if (!isObject(value)) return `${path} is not an object`;
  if (!isText(value.text, 600)) return `${path}.text is not a string of at most 600 characters`;
  if (typeof value.verified !== "boolean") return `${path}.verified is not true/false`;
  if (!(value.pos === null || (typeof value.pos === "number" && value.pos >= 0 && value.pos <= 1))) return `${path}.pos is not between 0 and 1`;
  return null;
}

/** Says what is wrong with an analysis (for example "features[2].stance is not allowed"), or null when it is fine. */
export function analysisProblem(value: unknown): string | null {
  if (!isObject(value)) return "analysis is not an object";
  if (JSON.stringify(value).length > 250_000) return "analysis is too large";
  if (value.version !== 1) return "version is not 1";
  if (!isText(value.summary, 2000)) return "summary is not a string of at most 2000 characters";
  if (!oneOf(["hi", "en", "mixed"] as const, value.language)) return "language is not hi, en or mixed";
  const idea = value.ideaSentiment;
  if (!isObject(idea)) return "ideaSentiment is missing";
  if (!isScore(idea.score)) return "ideaSentiment.score is not between -1 and 1";
  if (!oneOf(SENTIMENT_LABELS, idea.label)) return "ideaSentiment.label is not allowed";
  if (!isText(idea.reasoning, 1000)) return "ideaSentiment.reasoning is too long";
  if (!isList(idea.evidence, 10)) return "ideaSentiment.evidence is not a list of at most 10";
  for (const [index, item] of idea.evidence.entries()) { const problem = evidenceProblem(item, `ideaSentiment.evidence[${index}]`, false); if (problem) return problem; }
  if (!oneOf(VERDICTS, value.verdict)) return "verdict is not allowed";
  const concern = value.problemConcern;
  if (!isObject(concern)) return "problemConcern is missing";
  if (!oneOf(LEVELS, concern.level)) return "problemConcern.level is not allowed";
  if (!isText(concern.note, 500)) return "problemConcern.note is too long";
  if (!oneOf(INTENTS, value.wouldUse)) return "wouldUse is not allowed";
  if (!oneOf(INTENTS, value.wouldPay)) return "wouldPay is not allowed";
  const topics = value.topics;
  if (!isObject(topics)) return "topics is missing";
  for (const name of ["UX", "Pricing", "Features"]) {
    const topic = topics[name];
    if (!isObject(topic) || typeof topic.discussed !== "boolean" || !isScore(topic.score)) return `topics.${name} is invalid`;
  }
  if (!isList(value.features, 60)) return "features is not a list of at most 60";
  for (const [index, item] of value.features.entries()) {
    const at = `features[${index}]`;
    if (!isObject(item)) return `${at} is not an object`;
    if (!isText(item.name, 100)) return `${at}.name is too long`;
    if (!oneOf(STANCES, item.stance)) return `${at}.stance is not allowed`;
    if (!isScore(item.score)) return `${at}.score is not between -1 and 1`;
    if (!oneOf(IMPORTANCE, item.importance)) return `${at}.importance is not allowed`;
    const problem = evidenceProblem(item.evidence === undefined ? null : item.evidence, `${at}.evidence`, true); if (problem) return problem;
  }
  if (!isList(value.mentions, 80)) return "mentions is not a list of at most 80";
  for (const [index, item] of value.mentions.entries()) {
    const at = `mentions[${index}]`;
    if (!isObject(item)) return `${at} is not an object`;
    if (!oneOf(MENTION_TYPES, item.type)) return `${at}.type is not allowed`;
    if (!isText(item.text, 600)) return `${at}.text is too long`;
    const problem = evidenceProblem(item.evidence === undefined ? null : item.evidence, `${at}.evidence`, true); if (problem) return problem;
  }
  if (value.profile !== undefined) {
    const profile = value.profile;
    if (!isObject(profile)) return "profile is not an object";
    if (!oneOf(ROLES, profile.role)) return "profile.role is not allowed";
    if (!isList(profile.transport, 10) || !profile.transport.every((mode) => oneOf(TRANSPORT, mode))) return "profile.transport is invalid";
    if (!oneOf(ACCIDENTS, profile.accident)) return "profile.accident is not allowed";
    if (!oneOf(UNDERSTANDING, profile.understanding)) return "profile.understanding is not allowed";
  }
  if (value.qa !== undefined) {
    if (!isList(value.qa, 30)) return "qa is not a list of at most 30";
    for (const [index, item] of value.qa.entries()) {
      const at = `qa[${index}]`;
      if (!isObject(item)) return `${at} is not an object`;
      if (!isText(item.question, 400) || !isText(item.answer, 600)) return `${at} has a question or answer that is too long`;
      if (!oneOf(TONES, item.tone)) return `${at}.tone is not allowed`;
      const problem = evidenceProblem(item.evidence === undefined ? null : item.evidence, `${at}.evidence`, true); if (problem) return problem;
    }
  }
  if (value.turns !== undefined) {
    if (!isList(value.turns, 2000)) return "turns is not a list of at most 2000";
    for (const [index, turn] of value.turns.entries()) {
      if (!isObject(turn) || (turn.who !== "I" && turn.who !== "C") || !Number.isInteger(turn.s) || !Number.isInteger(turn.e) || (turn.s as number) < 0 || (turn.e as number) <= (turn.s as number)) return `turns[${index}] is invalid`;
    }
  }
  if (!isList(value.keyPoints, 20) || !value.keyPoints.every((item) => isText(item, 500))) return "keyPoints is invalid";
  if (!isList(value.alternatives, 20) || !value.alternatives.every((item) => isText(item, 200))) return "alternatives is invalid";
  const flags = value.flags;
  if (!isObject(flags) || typeof flags.needsReview !== "boolean" || !isList(flags.reasons, 20) || !flags.reasons.every((item) => isText(item, 80))) return "flags is invalid";
  if (!isObject(value.meta)) return "meta is missing";
  return null;
}

export const isValidAnalysis = (value: unknown): value is TrataAnalysis => analysisProblem(value) === null;

const cut = (value: unknown, max: number) => { const text = typeof value === "string" ? value : ""; return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text; };

/**
 * Shortens anything longer than the limits the validator allows. The engine already keeps to them; this protects against results
 * saved by an older engine version, so a long sentence never costs a whole interview.
 */
export function clampAnalysis(analysis: TrataAnalysis): TrataAnalysis {
  const evidence = <T extends Evidence | null>(item: T): T => (item ? { ...item, text: cut(item.text, 600) } : item);
  return {
    ...analysis,
    summary: cut(analysis.summary, 2000),
    ideaSentiment: { ...analysis.ideaSentiment, reasoning: cut(analysis.ideaSentiment.reasoning, 1000), evidence: (analysis.ideaSentiment.evidence ?? []).slice(0, 10).map((item) => evidence(item)) },
    problemConcern: { ...analysis.problemConcern, note: cut(analysis.problemConcern.note, 500) },
    features: (analysis.features ?? []).slice(0, 60).map((feature) => ({ ...feature, name: cut(feature.name, 100), evidence: evidence(feature.evidence ?? null) })),
    mentions: (analysis.mentions ?? []).slice(0, 80).map((mention) => ({ ...mention, text: cut(mention.text, 600), evidence: evidence(mention.evidence ?? null) })),
    ...(analysis.qa ? { qa: analysis.qa.slice(0, 30).map((item) => ({ ...item, question: cut(item.question, 400), answer: cut(item.answer, 600), evidence: evidence(item.evidence ?? null) })) } : {}),
    keyPoints: (analysis.keyPoints ?? []).slice(0, 20).map((point) => cut(point, 500)),
    alternatives: (analysis.alternatives ?? []).slice(0, 20).map((item) => cut(item, 200)),
    flags: { ...analysis.flags, reasons: (analysis.flags?.reasons ?? []).slice(0, 20).map((reason) => cut(reason, 80)) },
  };
}

/** Where a verdict sits on the -1..1 scale of the charts and the dashboard colours. */
export function sentimentTone(scoreValue: number): "positive" | "negative" | "neutral" {
  return scoreValue > 0.15 ? "positive" : scoreValue < -0.15 ? "negative" : "neutral";
}

const joined = (items: string[]) => items.filter(Boolean).join(" | ");

/** The analysis flattened into the extra CSV columns (name -> value). `analysis_json` keeps everything. */
export function analysisCsvColumns(analysis: TrataAnalysis | undefined): Record<string, string | number> {
  if (!analysis) {
    return { idea_label: "", verdict: "", would_use: "", would_pay: "", problem_concern: "", customer_role: "", transport: "", accident_experience: "", understood_idea: "", questions_and_answers: "", needs_review: "", review_reasons: "", summary: "", features: "", specific_mentions: "", asr_engine: "", asr_model: "", llm_model: "", duration_sec: "", analysis_json: "" };
  }
  return {
    idea_label: analysis.ideaSentiment.label,
    verdict: analysis.verdict,
    would_use: analysis.wouldUse,
    would_pay: analysis.wouldPay,
    problem_concern: analysis.problemConcern.level,
    customer_role: analysis.profile?.role ?? "",
    transport: (analysis.profile?.transport ?? []).join("; "),
    accident_experience: analysis.profile?.accident ?? "",
    understood_idea: analysis.profile?.understanding ?? "",
    questions_and_answers: joined((analysis.qa ?? []).map((item) => `Q: ${item.question} A: ${item.answer} [${item.tone}]`)),
    needs_review: analysis.flags.needsReview ? "yes" : "no",
    review_reasons: analysis.flags.reasons.join("; "),
    summary: analysis.summary,
    features: joined(analysis.features.map((feature) => `${feature.name} [${feature.stance} ${feature.score.toFixed(2)}${feature.importance === "must_have" ? ", must-have" : ""}]`)),
    specific_mentions: joined(analysis.mentions.map((mention) => `${mention.type}: ${mention.text}${mention.evidence ? ` - "${mention.evidence.text}"` : ""}`)),
    asr_engine: analysis.meta.asrEngine ?? "",
    asr_model: analysis.meta.asrModel ?? "",
    llm_model: analysis.meta.llmModel ?? "",
    duration_sec: analysis.meta.durationSec ?? "",
    analysis_json: JSON.stringify(analysis),
  };
}

export const ANALYSIS_CSV_HEADERS = Object.keys(analysisCsvColumns(undefined));
