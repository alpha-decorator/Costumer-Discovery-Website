import type { Interview } from "@/lib/interviews";
import { analyzeWithRules, RULES_ENGINE_NAME } from "@/lib/rules";
import type { TrataAnalysis } from "@/lib/trata";

export type RulesResult = {
  analysis: TrataAnalysis;
  sentiment: number;
  topics: Interview["topics"];
  keyPoints: string[];
  language: Interview["language"];
  analysisEngine: "trata-rules";
};

/**
 * Reads a call transcript with the built-in word lists and patterns (src/lib/rules). It needs no model, no download and no server,
 * so it runs the same way in the browser, on Vercel and on a laptop, and always gives the same answer for the same text.
 */
export function analyzeNotesWithRules(text: string, options: { lang: "en" | "hi"; meta?: TrataAnalysis["meta"] }): RulesResult {
  const analysis = analyzeWithRules(text, { lang: options.lang, meta: options.meta });
  const keyPoints = analysis.keyPoints.length ? analysis.keyPoints : [(analysis.summary || text).slice(0, 240)];
  return {
    analysis,
    sentiment: analysis.ideaSentiment.score,
    topics: { UX: analysis.topics.UX.score, Pricing: analysis.topics.Pricing.score, Features: analysis.topics.Features.score },
    keyPoints,
    language: analysis.language,
    analysisEngine: RULES_ENGINE_NAME as "trata-rules",
  };
}
