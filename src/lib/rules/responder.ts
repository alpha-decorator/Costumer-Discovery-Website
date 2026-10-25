/**
 * The responder-only report. The customer (responder) is the only source of opinions: each interviewer question is kept as
 * context for the answer that follows it, and the interviewer's pitch and opinions are never scored or quoted here.
 * Entities are the things the customer named themselves: other products or habits they already use, and car makers.
 */
import type { SentimentLabel } from "@/lib/trata";
import type { ResponderInteraction, ResponderReport } from "@/lib/trata";
import type { Doc } from "./extract";
import * as L from "./lexicon";
import { once } from "./text";

type Lang = "en" | "hi";

const SENTIMENT: Record<Lang, Record<SentimentLabel, string>> = {
  en: { strong_positive: "Highly Positive", positive: "Positive", mixed: "Mixed", neutral: "Neutral", negative: "Negative", strong_negative: "Highly Negative", not_discussed: "Not discussed" },
  hi: { strong_positive: "बहुत सकारात्मक", positive: "सकारात्मक", mixed: "मिली-जुली", neutral: "तटस्थ", negative: "नकारात्मक", strong_negative: "बहुत नकारात्मक", not_discussed: "चर्चा नहीं हुई" },
};
const INTENT: Record<Lang, Record<string, string>> = {
  en: { yes: "yes", maybe: "maybe", no: "no", unclear: "not said" },
  hi: { yes: "हाँ", maybe: "शायद", no: "नहीं", unclear: "नहीं कहा" },
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** Products, habits, makers, Trata features and ideas the customer raised in this answer (matched on the normalised text). */
function entitiesIn(text: string): string[] {
  const found: string[] = [];
  for (const alternative of L.ALTERNATIVES) if (once(alternative.re).test(text)) found.push(alternative.name);
  for (const feature of L.FEATURES) if (once(feature.re).test(text)) found.push(feature.name);
  for (const idea of L.IDEAS) if (once(idea.re).test(text)) found.push(idea.label);
  for (const match of text.matchAll(new RegExp(L.CARMAKERS.source, "gu"))) found.push(match[0]);
  for (const mode of L.TRANSPORT_WORDS) if (mode.mode === "cab_taxi") for (const match of text.matchAll(new RegExp(mode.re.source, "gu"))) found.push(match[0]);
  return [...new Set(found)];
}

export function buildResponderReport(
  doc: Pick<Doc, "units" | "exchanges" | "cues">,
  input: { label: SentimentLabel; wouldUse: string; wouldPay: string; features: Array<{ name: string }>; labelFor: (score: number) => SentimentLabel },
  lang: Lang,
): ResponderReport {
  const words = SENTIMENT[lang];
  const extracted: ResponderInteraction[] = [];
  for (const exchange of doc.exchanges) {
    const answerText = exchange.a.map((index) => doc.units[index].n).join(" ").trim();
    if (!answerText) continue;
    // Opinions come only from the customer's answer units; a question's own wording never counts.
    const values = doc.cues.filter((cue) => exchange.a.includes(cue.unit) && cue.kind !== "doubt").map((cue) => cue.value);
    extracted.push({
      interviewer_context: clip(exchange.question, 200),
      responder_sentiment: values.length ? words[input.labelFor(mean(values))] : words.not_discussed,
      responder_insight: clip(exchange.answer, 300),
      unique_points_or_entities: entitiesIn(answerText),
    });
  }

  const raised = input.features.slice(0, 3).map((feature) => feature.name);
  const use = INTENT[lang][input.wouldUse] ?? INTENT[lang].unclear;
  const pay = INTENT[lang][input.wouldPay] ?? INTENT[lang].unclear;
  const insight = lang === "hi"
    ? `इस्तेमाल करेंगे: ${use}; पैसे देंगे: ${pay}।${raised.length ? ` सबसे ज़्यादा बात: ${raised.join(", ")}।` : ""}`
    : `Would use: ${use}; would pay: ${pay}.${raised.length ? ` Raised most: ${raised.join(", ")}.` : ""}`;

  return {
    interview_summary: { overall_responder_sentiment: words[input.label], overall_customer_insight: insight },
    extracted_interactions: extracted,
  };
}
