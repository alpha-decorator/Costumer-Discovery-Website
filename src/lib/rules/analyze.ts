/**
 * The rule-based analyzer: turns a call transcript (Hindi, Hinglish or English, with or without speaker labels) into the same
 * TrataAnalysis the AI engine produces, using nothing but word lists and patterns. It runs anywhere JavaScript runs: in the
 * browser, on Vercel, in tests. No model is downloaded and no server is needed.
 *
 * What it can and cannot do, honestly: it finds what is SAID (opinion phrases, "I would use / pay", accident stories, prices,
 * features, other products, requests, worries) and quotes the customer's own words as proof. It does not understand
 * sarcasm or long chains of reasoning; when the signals disagree or are thin it says so in `flags` instead of guessing.
 */
import type { AccidentExperience, Intent, Level, MentionType, Role, SentimentLabel, Stance, Tone, Transport, TrataAnalysis, Understanding, Verdict } from "@/lib/trata";
import { buildDoc, isCustomerCall, type UCue, extractAccident, extractConcern, extractFeatures, extractIntents, extractKeyPoints, extractMentions, extractQa, extractRole, extractTransport, extractUnderstanding, mergeFeatures, quote, type Doc } from "./extract";
import { buildResponderReport } from "./responder";
import { clip } from "./text";

export const RULES_VERSION = 1;
export const RULES_ENGINE_NAME = "trata-rules";

export type RulesOptions = { lang?: "en" | "hi"; meta?: TrataAnalysis["meta"] };

// ---------------------------------------------------------------- numbers (a port of the engine's own scoring rules) ------
const LABEL_BANDS: Record<SentimentLabel, [number, number]> = {
  strong_positive: [0.6, 1], positive: [0.2, 0.8], mixed: [-0.25, 0.25], neutral: [-0.15, 0.15], negative: [-0.8, -0.2], strong_negative: [-1, -0.6], not_discussed: [0, 0],
};
export function labelForScore(score: number): SentimentLabel {
  if (score >= 0.6) return "strong_positive";
  if (score >= 0.2) return "positive";
  if (score <= -0.6) return "strong_negative";
  if (score <= -0.2) return "negative";
  return Math.abs(score) < 0.1 ? "neutral" : "mixed";
}
const reconcile = (label: SentimentLabel, score: number) => { const [low, high] = LABEL_BANDS[label]; return Math.round(Math.max(low, Math.min(high, score)) * 1000) / 1000; };
export function verdictFor(score: number, label: SentimentLabel, wouldUse: Intent): Verdict {
  if (label === "not_discussed") return "no_signal";
  const verdict: Verdict = score >= 0.55 ? "strong_yes" : score >= 0.2 ? "lean_yes" : score <= -0.55 ? "strong_no" : score <= -0.2 ? "lean_no" : "undecided";
  return wouldUse === "no" && (verdict === "strong_yes" || verdict === "lean_yes") ? "undecided" : verdict;
}
const TONE_VALUE: Partial<Record<Tone, number>> = { positive: 0.6, mixed: 0.1, negative: -0.6 };
const INTENT_VALUE: Partial<Record<Intent, number>> = { yes: 0.7, maybe: 0.15, no: -0.7 };
const SENTIMENT_GAP = 0.4;

/** What the detailed answers (per-question tones, feature opinions, would-use, would-pay) add up to, or null when there is too little. */
function impliedScore(qa: Array<{ tone: Tone }>, features: Array<{ stance: Stance; score: number }>, wouldUse: Intent, wouldPay: Intent, minimum: number) {
  const values: Array<[number, number]> = [];
  for (const item of qa) { const value = TONE_VALUE[item.tone]; if (value !== undefined) values.push([value, 1]); }
  for (const feature of features) if (["positive", "negative", "mixed", "request"].includes(feature.stance)) values.push([feature.score, 1]);
  const use = INTENT_VALUE[wouldUse];
  if (use !== undefined) values.push([use, 2]);
  if (wouldPay === "yes" || wouldPay === "no") values.push([wouldPay === "yes" ? 0.7 : -0.5, 1]);
  const weight = values.reduce((sum, [, w]) => sum + w, 0);
  return weight < minimum ? null : values.reduce((sum, [v, w]) => sum + v * w, 0) / weight;
}

const ROMAN_HINDI = new Set("hai hain nahi nahin kya mujhe aap main mai bahut accha achha hoon hu karunga karungi kar ke ka ki ko se mein yeh ye woh wo lekin aur bhi par kaise kyun hoga hogi tha thi raha rahi liye paisa paise gaadi gadi hum humein tumhe batao bataiye theek thik sahi bilkul zaroor jaroor".split(" "));
export function scriptLanguage(text: string): "hi" | "en" | "mixed" {
  let devanagari = 0;
  let latin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x900 && code <= 0x97f) devanagari += 1;
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) latin += 1;
  }
  if (devanagari + latin === 0) return "en";
  const share = devanagari / (devanagari + latin);
  if (share > 0.55) return "hi";
  if (share >= 0.08) return "mixed";
  const words = text.toLowerCase().match(/[a-z']+/gu) ?? [];
  const roman = words.filter((word) => ROMAN_HINDI.has(word)).length;
  return words.length >= 8 && roman / words.length >= 0.1 ? "mixed" : "en";
}

// ---------------------------------------------------------------- words for the written summary ---------------------------
type Words = {
  role: Record<Role, string>; transport: Record<Transport, string>; accident: Record<AccidentExperience, string>;
  label: Record<SentimentLabel, string>; verdict: Record<Verdict, string>; intent: Record<Intent, string>; stance: Record<Stance, string>;
  type: Record<MentionType, string>; level: Record<Level, string>; understanding: Record<Understanding, string>;
};
const EN: Words = {
  role: { fleet_owner: "a fleet owner", professional_driver: "a professional driver", private_driver: "a private vehicle owner", passenger: "a commuter / passenger", safety_professional: "a road-safety professional", other: "someone else", unclear: "not clearly stated" },
  transport: { car: "car", two_wheeler: "two-wheeler", commercial_vehicle: "truck / commercial vehicle", bus: "bus", auto_rickshaw: "auto-rickshaw", cab_taxi: "cab / taxi", bicycle: "bicycle", walks: "on foot", public_transport: "metro / train", other: "other" },
  accident: { none: "no accident", near_miss: "a near miss", minor: "a minor accident", serious: "a serious accident", unclear: "not stated" },
  label: { strong_positive: "very positive", positive: "positive", mixed: "mixed", neutral: "neutral", negative: "negative", strong_negative: "very negative", not_discussed: "not discussed" },
  verdict: { strong_yes: "a clear yes", lean_yes: "leaning yes", undecided: "undecided", lean_no: "leaning no", strong_no: "a clear no", no_signal: "no clear signal" },
  intent: { yes: "yes", maybe: "maybe", no: "no", unclear: "not said" },
  stance: { positive: "positive", negative: "negative", neutral: "neutral", mixed: "mixed", request: "asked for", confused: "confused" },
  type: { feature_request: "feature requests", objection: "objections", pricing: "price talk", competitor: "other products", use_case: "use cases", pain_point: "pain points", privacy_concern: "privacy worries", suggestion: "suggestions", promise: "offers to help", other: "other remarks" },
  level: { none: "none", low: "low", medium: "medium", high: "high" },
  understanding: { clear: "understood the idea", partial: "partly understood the idea", confused: "was confused by the idea", unclear: "unclear" },
};
const HI: Words = {
  role: { fleet_owner: "फ्लीट मालिक", professional_driver: "प्रोफेशनल ड्राइवर", private_driver: "निजी वाहन चालक", passenger: "यात्री / कम्यूटर", safety_professional: "सड़क सुरक्षा से जुड़े पेशेवर", other: "अन्य", unclear: "साफ़ नहीं बताया" },
  transport: { car: "कार", two_wheeler: "दोपहिया", commercial_vehicle: "ट्रक / कमर्शियल वाहन", bus: "बस", auto_rickshaw: "ऑटो-रिक्शा", cab_taxi: "कैब / टैक्सी", bicycle: "साइकिल", walks: "पैदल", public_transport: "मेट्रो / ट्रेन", other: "अन्य" },
  accident: { none: "कोई दुर्घटना नहीं", near_miss: "बाल-बाल बचना", minor: "छोटी दुर्घटना", serious: "गंभीर दुर्घटना", unclear: "नहीं बताया" },
  label: { strong_positive: "बहुत सकारात्मक", positive: "सकारात्मक", mixed: "मिली-जुली", neutral: "तटस्थ", negative: "नकारात्मक", strong_negative: "बहुत नकारात्मक", not_discussed: "चर्चा नहीं हुई" },
  verdict: { strong_yes: "साफ़ हाँ", lean_yes: "हाँ की ओर झुकाव", undecided: "अनिश्चित", lean_no: "ना की ओर झुकाव", strong_no: "साफ़ ना", no_signal: "कोई साफ़ संकेत नहीं" },
  intent: { yes: "हाँ", maybe: "शायद", no: "नहीं", unclear: "नहीं कहा" },
  stance: { positive: "सकारात्मक", negative: "नकारात्मक", neutral: "तटस्थ", mixed: "मिली-जुली", request: "माँगा", confused: "उलझन" },
  type: { feature_request: "फ़ीचर की माँग", objection: "आपत्तियाँ", pricing: "कीमत की बात", competitor: "दूसरे प्रोडक्ट", use_case: "इस्तेमाल के मौके", pain_point: "परेशानियाँ", privacy_concern: "प्राइवेसी की चिंता", suggestion: "सुझाव", promise: "मदद का प्रस्ताव", other: "अन्य बातें" },
  level: { none: "कोई नहीं", low: "कम", medium: "मध्यम", high: "ज़्यादा" },
  understanding: { clear: "आइडिया समझ गए", partial: "आइडिया आंशिक रूप से समझे", confused: "आइडिया से उलझन में रहे", unclear: "साफ़ नहीं" },
};

// ---------------------------------------------------------------- pieces of the result ------------------------------------
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const round3 = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 1000) / 1000;

/** The evidence for a one-word reply ("हाँ.") is the question it answers too, so the quote means something on its own. */
function evidenceForCue(doc: Doc, cue: UCue) {
  if (cue.from === undefined) return evidenceFor(doc, cue.unit);
  const unit = doc.units[cue.unit];
  const text = doc.raw.slice(doc.map[cue.from], doc.map[unit.ne]).trim();
  return { text: text.slice(0, 580), pos: Math.round((doc.map[cue.from] / Math.max(1, doc.raw.length)) * 10000) / 10000, verified: true };
}

function evidenceFor(doc: Doc, index: number) {
  const unit = doc.units[index];
  const before = doc.units[index - 1];
  if (unit.words < 3 && before && before.kind === "Q" && unit.s - before.e <= 6) {
    const text = doc.raw.slice(before.s, unit.e).trim();
    if (text.length <= 580) return { text, pos: Math.round((before.s / Math.max(1, doc.raw.length)) * 10000) / 10000, verified: true };
  }
  return quote(doc, index);
}

function emptyAnalysis(text: string, lang: "en" | "hi", options: RulesOptions, reason: string): TrataAnalysis {
  const words = text.split(/\s+/u).filter(Boolean).length;
  return {
    version: 1,
    summary: reason === "not_a_customer_call"
      ? (lang === "hi" ? "यह Trata के बारे में ग्राहक की बातचीत जैसा नहीं लगा (कोई सवाल-जवाब या Trata/दुर्घटना/सफ़र की बात नहीं मिली), इसलिए कोई राय दर्ज नहीं की गई।" : "This does not look like a customer call about Trata (no interviewer questions or talk about the product, accidents or travel), so no opinion was recorded.")
      : (lang === "hi" ? "विश्लेषण के लिए पर्याप्त टेक्स्ट नहीं था।" : "There was not enough text to analyze."),
    language: scriptLanguage(text),
    ideaSentiment: { score: 0, label: "not_discussed", reasoning: "", evidence: [] },
    verdict: "no_signal",
    problemConcern: { level: "none", note: "" },
    wouldUse: "unclear", wouldPay: "unclear",
    topics: { UX: { discussed: false, score: 0 }, Pricing: { discussed: false, score: 0 }, Features: { discussed: false, score: 0 } },
    features: [], mentions: [], keyPoints: [], alternatives: [],
    flags: { needsReview: true, reasons: [reason] },
    meta: { ...options.meta, llmModel: `${RULES_ENGINE_NAME} v${RULES_VERSION}`, wordCount: words, processedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), reportLanguage: lang, speakers: "none" },
  };
}

function turnsOf(doc: Doc) {
  if (doc.mode === "guessed") return undefined;
  const turns: Array<{ who: "I" | "C"; s: number; e: number }> = [];
  for (const unit of doc.units) {
    const last = turns[turns.length - 1];
    if (last && last.who === unit.who) last.e = unit.e;
    else turns.push({ who: unit.who, s: unit.s, e: unit.e });
  }
  return turns.filter((turn) => turn.e > turn.s).slice(0, 2000);
}

// ---------------------------------------------------------------- the analyzer -------------------------------------------
/**
 * Removes the time codes a transcript carries ("00:01" lines, "[02:15]", "(1:20:03)") and the boilerplate line some
 * transcription tools add. Timestamps say nothing about what the customer thinks, and as lines of their own they would
 * otherwise split the call into fake speaker turns.
 */
export function stripTimestamps(text: string) {
  return text
    .replace(/^\s*this content was generated by ai\s*$/gimu, "")
    .replace(/^\s*\[?\(?\d{1,2}:\d{2}(?::\d{2})?\)?\]?\s*$/gmu, "")
    .replace(/\[?\(?\b\d{1,2}:\d{2}(?::\d{2})?\)?\]?/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n+/gu, "\n")
    .trim();
}

export function analyzeWithRules(raw: string, options: RulesOptions = {}): TrataAnalysis {
  const lang = options.lang === "hi" ? "hi" : "en";
  const W = lang === "hi" ? HI : EN;
  const text = stripTimestamps(raw);
  const words = text.split(/\s+/u).filter(Boolean).length;
  if (words < 8) return emptyAnalysis(text, lang, options, "very_short");

  const doc = buildDoc(text);
  if (!isCustomerCall(doc)) return emptyAnalysis(text, lang, options, "not_a_customer_call");
  const intents = extractIntents(doc);
  const accident = extractAccident(doc);
  const transport = extractTransport(doc);
  const role = extractRole(doc, transport);
  const features = mergeFeatures(extractFeatures(doc));
  const { mentions, alternatives } = extractMentions(doc, lang);
  const qa = extractQa(doc);
  const understanding = extractUnderstanding(doc, features);
  const painPoints = mentions.filter((mention) => mention.type === "pain_point").length;
  const concern = extractConcern(doc, accident, painPoints);

  // ---- the headline score
  const opinions = doc.cues.filter((cue) => cue.kind !== "doubt");
  const doubts = doc.cues.filter((cue) => cue.kind === "doubt");
  const weight = opinions.reduce((sum, cue) => sum + cue.weight, 0);
  const opinionScore = weight ? opinions.reduce((sum, cue) => sum + cue.value * cue.weight, 0) / (weight + 0.5) : 0;
  const implied = impliedScore(qa, features, intents.wouldUse, intents.wouldPay, opinions.length ? 3 : 2);
  const reasons: string[] = [];
  if (doc.introAt < 0) reasons.push("no_product_intro");
  let score: number | null = null;
  if (opinions.length && implied !== null) {
    if (Math.abs(opinionScore - implied) > SENTIMENT_GAP) { score = (opinionScore + implied) / 2; reasons.push("sentiment_adjusted"); }
    else score = opinionScore * 0.6 + implied * 0.4;
  } else if (opinions.length) score = opinionScore;
  else if (implied !== null) score = implied * 0.8;
  if (score !== null) score -= Math.min(doubts.length * 0.03, 0.15);
  const discussed = score !== null;
  let label: SentimentLabel = discussed ? labelForScore(score!) : "not_discussed";
  const finalScore = discussed ? reconcile(label, Math.max(-1, Math.min(1, score!))) : 0;
  if (!discussed) label = "not_discussed";
  const verdict = verdictFor(finalScore, label, intents.wouldUse);

  // ---- proof: the customer's strongest remarks, each in their own words, in call order
  const strongest = [...opinions].sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight));
  const chosen: UCue[] = [];
  for (const cue of strongest) if (!chosen.some((item) => item.unit === cue.unit) && chosen.length < 5) chosen.push(cue);
  const evidence = chosen.sort((a, b) => a.start - b.start).map((cue) => evidenceForCue(doc, cue));

  const positive = opinions.filter((cue) => cue.value > 0.15);
  const negative = opinions.filter((cue) => cue.value < -0.15);
  if (discussed && opinions.length < 3) reasons.push("few_opinions");
  if (positive.filter((cue) => cue.value >= 0.4).length >= 2 && negative.filter((cue) => cue.value <= -0.4).length >= 2) reasons.push("mixed_signals");
  if (words < 40) reasons.push("very_short");
  if (doc.mode === "guessed" && words >= 120) reasons.push("no_speaker_split");
  if (options.meta?.warnings?.length) reasons.push("asr_warning");

  // ---- topics
  const topicCues = (name: "UX" | "Pricing" | "Features") => opinions.filter((cue) => cue.topic === name);
  const uxCues = topicCues("UX");
  const uxFeature = features.find((feature) => feature.name === "Mobile app and website");
  const priceTalk = mentions.some((mention) => mention.type === "pricing") || intents.pay.yes + intents.pay.no + intents.pay.maybe > 0;
  const priceValues = [...topicCues("Pricing").map((cue) => cue.value), ...(intents.wouldPay === "yes" ? [0.5] : intents.wouldPay === "no" ? [-0.5] : [])];
  const featureValues = features.filter((feature) => feature.stance !== "neutral").map((feature) => feature.score);
  const topics = {
    UX: { discussed: uxCues.length > 0 || !!uxFeature, score: uxCues.length || uxFeature ? round3(mean([...uxCues.map((cue) => cue.value), ...(uxFeature ? [uxFeature.score] : [])])) : 0 },
    Pricing: { discussed: priceTalk, score: priceTalk ? round3(mean(priceValues)) : 0 },
    Features: { discussed: features.length > 0, score: features.length ? round3(mean(featureValues)) : 0 },
  };

  // ---- the written parts
  const modeNames = transport.map((mode) => W.transport[mode]);
  const typeCounts = new Map<MentionType, number>();
  for (const mention of mentions) typeCounts.set(mention.type, (typeCounts.get(mention.type) ?? 0) + 1);
  const topTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([type, count]) => `${W.type[type]}${count > 1 ? ` ×${count}` : ""}`);
  const featureNames = features.slice(0, 4).map((feature) => `${feature.name} (${W.stance[feature.stance]})`);
  const sentences: string[] = [];
  if (lang === "hi") {
    const who = [role !== "unclear" ? W.role[role] : "", modeNames.length ? `${modeNames.join(", ")} से चलते हैं` : "", accident.value !== "unclear" ? `दुर्घटना का अनुभव: ${W.accident[accident.value]}` : ""].filter(Boolean);
    if (who.length) sentences.push(`ग्राहक — ${who.join("; ")}।`);
    sentences.push(discussed ? `Trata के बारे में कुल राय ${W.label[label]} (${W.verdict[verdict]}) रही।` : "Trata के बारे में कोई साफ़ राय नहीं मिली।");
    const intent = [intents.wouldUse !== "unclear" ? `इस्तेमाल करेंगे: ${W.intent[intents.wouldUse]}` : "", intents.wouldPay !== "unclear" ? `पैसे देंगे: ${W.intent[intents.wouldPay]}` : ""].filter(Boolean);
    if (intent.length) sentences.push(`${intent.join("; ")}।`);
    if (featureNames.length) sentences.push(`फ़ीचर पर बात: ${featureNames.join(", ")}।`);
    if (topTypes.length) sentences.push(`और ये बातें आईं: ${topTypes.join(", ")}।`);
    if (alternatives.length) sentences.push(`पहले से इस्तेमाल/जानकारी: ${alternatives.slice(0, 3).join(", ")}।`);
  } else {
    const who = [role !== "unclear" ? W.role[role] : "", modeNames.length ? `travels by ${modeNames.join(", ")}` : "", accident.value !== "unclear" ? `accident experience: ${W.accident[accident.value]}` : ""].filter(Boolean);
    if (who.length) sentences.push(`Customer — ${who.join("; ")}.`);
    sentences.push(discussed ? `Overall opinion of Trata: ${W.label[label]} (${W.verdict[verdict]}).` : "No clear opinion about Trata was expressed.");
    const intent = [intents.wouldUse !== "unclear" ? `would use: ${W.intent[intents.wouldUse]}` : "", intents.wouldPay !== "unclear" ? `would pay: ${W.intent[intents.wouldPay]}` : ""].filter(Boolean);
    if (intent.length) sentences.push(`${intent[0][0].toUpperCase()}${intent.join("; ").slice(1)}.`);
    if (featureNames.length) sentences.push(`Features discussed: ${featureNames.join(", ")}.`);
    if (topTypes.length) sentences.push(`Also raised: ${topTypes.join(", ")}.`);
    if (alternatives.length) sentences.push(`Already knows or uses: ${alternatives.slice(0, 3).join(", ")}.`);
  }
  const summary = clip(sentences.join(" "), 1900);

  const top = strongest[0];
  const reasoning = !discussed
    ? (lang === "hi" ? "ग्राहक की अपनी बातों में Trata के बारे में कोई राय वाला वाक्यांश नहीं मिला।" : "No opinion phrase about Trata was found in the customer's own words.")
    : lang === "hi"
      ? `ग्राहक के ${opinions.length} राय वाले वाक्यांशों पर आधारित (${positive.length} सकारात्मक, ${negative.length} नकारात्मक${doubts.length ? `, ${doubts.length} संदेह/सवाल` : ""})। सबसे मज़बूत: “${top ? doc.raw.slice(doc.map[top.start], doc.map[top.end]) : ""}”।`
      : `Based on ${opinions.length} opinion phrase${opinions.length === 1 ? "" : "s"} from the customer (${positive.length} positive, ${negative.length} negative${doubts.length ? `, ${doubts.length} doubts or open questions` : ""}). Strongest: “${top ? doc.raw.slice(doc.map[top.start], doc.map[top.end]) : ""}”.`;

  const concernNote = concern.level === "none"
    ? (lang === "hi" ? "सड़क सुरक्षा की चिंता की कोई बात नहीं आई।" : "No road-safety concern was voiced.")
    : `${lang === "hi" ? "स्तर" : "Level"}: ${W.level[concern.level]}${concern.unit !== null ? ` — “${clip(doc.units[concern.unit].text, 160)}”` : ""}`;

  const turns = turnsOf(doc);
  const processedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  return {
    version: 1,
    summary,
    language: scriptLanguage(text),
    ideaSentiment: { score: finalScore, label, reasoning: clip(reasoning, 900), evidence },
    verdict,
    problemConcern: { level: concern.level, note: clip(concernNote, 480) },
    wouldUse: intents.wouldUse,
    wouldPay: intents.wouldPay,
    topics,
    features: features.slice(0, 25),
    mentions,
    profile: { role, transport, accident: accident.value, understanding },
    qa,
    responder: buildResponderReport(doc, { label, wouldUse: intents.wouldUse, wouldPay: intents.wouldPay, features, labelFor: labelForScore }, lang),
    ...(turns && turns.length ? { turns } : {}),
    keyPoints: extractKeyPoints(doc, mentions),
    alternatives,
    flags: { needsReview: reasons.length > 0, reasons },
    meta: {
      ...options.meta, llmModel: `${RULES_ENGINE_NAME} v${RULES_VERSION}`, wordCount: words, processedAt, reportLanguage: lang,
      speakers: turns && turns.length ? "rules" : "none",
    },
  };
}
