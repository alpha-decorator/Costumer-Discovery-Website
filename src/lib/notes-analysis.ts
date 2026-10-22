type Topic = "UX" | "Pricing" | "Features";

const terms: Array<[string, number]> = [
  ["excellent", 0.9], ["great", 0.75], ["good", 0.55], ["helpful", 0.7], ["easy", 0.65], ["clear", 0.55], ["useful", 0.65], ["love", 0.85], ["like", 0.45], ["works well", 0.65],
  ["bad", -0.6], ["poor", -0.75], ["difficult", -0.6], ["confusing", -0.65], ["slow", -0.5], ["expensive", -0.65], ["problem", -0.45], ["issue", -0.35], ["frustrating", -0.8], ["hate", -0.9], ["not good", -0.65],
  ["बहुत अच्छा", 0.85], ["अच्छा", 0.55], ["बेहतरीन", 0.9], ["शानदार", 0.9], ["पसंद", 0.7], ["आसान", 0.65], ["मददगार", 0.7], ["उपयोगी", 0.65],
  ["खराब", -0.75], ["मुश्किल", -0.6], ["कठिन", -0.6], ["भ्रमित", -0.65], ["महंगा", -0.65], ["महँगा", -0.65], ["समस्या", -0.5], ["निराश", -0.8], ["धीमा", -0.45], ["परेशान", -0.7],
];
const negation = /\b(not|no|never|don't|doesn't|didn't|isn't|can't|cannot|won't)\b|नहीं|मत/i;
const topicTerms: Record<Topic, string[]> = {
  UX: ["easy", "confusing", "button", "dashboard", "setup", "navigation", "आसान", "मुश्किल", "डैशबोर्ड", "बटन", "शुरुआत"],
  Pricing: ["price", "pricing", "cost", "expensive", "cheap", "subscription", "कीमत", "मूल्य", "महंगा", "खर्च"],
  Features: ["feature", "report", "export", "insight", "compare", "workflow", "सुविधा", "रिपोर्ट", "तुलना", "जानकारी"],
};

function scoreSentence(sentence: string) {
  const lower = sentence.toLocaleLowerCase();
  const scores = terms.flatMap(([term, value]) => {
    const index = lower.indexOf(term);
    if (index < 0) return [];
    const before = lower.slice(Math.max(0, index - 30), index);
    return [negation.test(before) ? -value * 0.75 : value];
  });
  return scores.length ? Math.max(-1, Math.min(1, scores.reduce((sum, value) => sum + value, 0) / Math.sqrt(scores.length))) : 0;
}

export function analyzeNotes(text: string) {
  const sentences = text.split(/(?<=[.!?।\n])\s*/).map((sentence) => sentence.trim()).filter(Boolean);
  const scored = sentences.map((sentence) => ({ sentence, score: scoreSentence(sentence) }));
  const sentiment = scored.length ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length : 0;
  const topics = Object.fromEntries((Object.keys(topicTerms) as Topic[]).map((topic) => {
    const related = scored.filter(({ sentence }) => topicTerms[topic].some((term) => sentence.toLocaleLowerCase().includes(term)));
    return [topic, related.length ? related.reduce((sum, item) => sum + item.score, 0) / related.length : sentiment];
  })) as Record<Topic, number>;
  const seen = new Set<string>();
  const keyPoints = scored
    .filter(({ sentence }) => sentence.length > 18)
    .sort((a, b) => Number(b.score !== 0) - Number(a.score !== 0) || b.sentence.length - a.sentence.length)
    .filter(({ sentence }) => {
      const key = sentence.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (key.length < 12 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map(({ sentence }) => sentence);
  const hindi = (text.match(/[\u0900-\u097f]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  const language = hindi && latin ? "mixed" : hindi ? "hi" : "en";
  return { sentiment, topics, keyPoints: keyPoints.length ? keyPoints : [text.slice(0, 500)], language };
}
