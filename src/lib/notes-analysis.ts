import { callUnits, opinionKeyPoints, scoreCall, type CallSentiment, type Cue } from "@/lib/call-sentiment";

type Topic = "UX" | "Pricing" | "Features";
const TOPICS: Topic[] = ["UX", "Pricing", "Features"];

/** Mean opinion per topic from the phrases that belong to it; a topic nobody touched takes the overall score. */
export function topicScores(cues: Cue[], overall: number) {
  return Object.fromEntries(TOPICS.map((topic) => {
    const related = cues.filter((cue) => cue.topic === topic && cue.kind !== "doubt");
    const weight = related.reduce((sum, cue) => sum + cue.weight, 0);
    return [topic, weight ? Math.max(-1, Math.min(1, related.reduce((sum, cue) => sum + cue.value * cue.weight, 0) / weight)) : overall];
  })) as Record<Topic, number>;
}

export function detectLanguage(text: string) {
  const hindi = (text.match(/[\u0900-\u097f]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return hindi && latin ? "mixed" : hindi ? "hi" : "en";
}

export function keyPointsFor(text: string) {
  const points = opinionKeyPoints(text);
  if (points.length) return points;
  const units = callUnits(text).filter((unit) => unit.length > 18).slice(0, 3);
  return units.length ? units : [text.slice(0, 500)];
}

export type NotesAnalysis = {
  sentiment: number; topics: Record<Topic, number>; keyPoints: string[]; language: string;
  /** "none": no opinion about the product was found (sentiment is 0 because there is nothing to measure). */
  confidence: CallSentiment["confidence"]; cues: Cue[];
};

/**
 * Offline analysis of a pasted transcript or notes. It is tuned for Trata customer calls: it scores only what the customer
 * says about the product, its price and whether they would use it, and ignores accident / injury / road-problem talk. See
 * call-sentiment.ts for the reasoning.
 */
export function analyzeNotes(text: string): NotesAnalysis {
  const call = scoreCall(text);
  return {
    sentiment: call.score,
    topics: topicScores(call.cues, call.score),
    keyPoints: keyPointsFor(text),
    language: detectLanguage(text),
    confidence: call.confidence,
    cues: call.cues,
  };
}
