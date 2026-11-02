/**
 * Reads a customer call with word lists and patterns only (no model). One pass builds a Doc (the text cut into short pieces,
 * each marked as the interviewer's question, the interviewer's pitch or the customer's own words, plus every opinion phrase
 * the customer said). The functions below then read the Doc: what they would use / pay, what they ride, whether they have
 * been in an accident, which features they talked about, and everything else worth keeping.
 *
 * Only the customer's own words are ever used as evidence. Every quote is a piece of the original text, never reworded.
 */
import { findCuesNormalized, phrase, type Cue } from "@/lib/call-sentiment";
import type { AccidentExperience, Evidence, FeatureOpinion, Importance, Intent, Level, Mention, MentionType, Role, Stance, Tone, Transport, Understanding } from "@/lib/trata";
import { classify, pitchScore, QUESTION_ANYWHERE, YOU, type Classified, type SpeakerMode } from "./classify";
import * as L from "./lexicon";
import { clip, normalizeMapped, once, segment, unitAt } from "./text";

/** An opinion phrase inside piece `unit`. `from` (normalised position) is set when the phrase was found at the end of a long run that also held the interviewer's question: the quote then starts there. */
export type UCue = Cue & { unit: number; from?: number };
/** A question the interviewer asked (one or more pieces) and the customer's reply (up to four pieces). */
export type Exchange = { q: number[]; a: number[]; question: string; answer: string };
export type Doc = {
  raw: string; norm: string; map: number[];
  units: Classified[]; mode: SpeakerMode;
  /** Opinion phrases and doubts said by the customer, each with the piece it sits in. */
  cues: UCue[];
  exchanges: Exchange[];
  /** The piece where the interviewer first introduces the product (the pitch, or else the first mention); -1 when there is none. */
  introAt: number;
};

const re = L.re;
const near = L.near;
const globals = new WeakMap<RegExp, RegExp>();
/** The same expression with the "g" flag, compiled once and rewound every time it is handed out. */
const globalOf = (pattern: RegExp) => {
  let found = globals.get(pattern);
  if (!found) { found = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`); globals.set(pattern, found); }
  found.lastIndex = 0;
  return found;
};
const NEG = once(phrase("नहीं|नही|मत|not|no|never|dont|don't|doesnt|doesn't|isnt|isn't|cant|can't|cannot|wont|won't|nahi|nahin|ना"));
const POSITIVE_CUE = 0.15;

// ============================================================================ building the Doc ==================
const OPINION_Q = re("कैसा\\s+लगा|कैसी\\s+लगी|कैसा\\s+लग|कैसी\\s+लग|कैसा\\s+है|कैसी\\s+है|लगता\\s+है|पसंद|यूसफुल|यूजफुल|useful|उपयोगी|मददगार|helpful|काम\\s+का|काम\\s+की|आइडिया|आईडिया|idea|सोल्यूशन|सॉल्यूशन|solution|सही|अच्छा|good|think|feel|like|राय|सोचते|opinion|interesting|इंटरेस्टिंग|बेहतर|फायदेमंद|beneficial|worth|जरूरी|necessary|need|reaction|react|फायदा|फ़ायदा|faayda|fayda|भरोसा|विश्वास|bharosa|thoughts|thought|views|view|impression|perspective|feedback|trust|excite|excitement|excited|kaisa|kaisi|pasand|accha|achha|acha|laga|lagta|sochte|raay|rai|vichar|विचार");
const PRICE_QUOTE = re("(?:₹|rs\\.?|inr)\\s*[0-9][0-9,]*|[0-9][0-9,]*(?:\\.[0-9]+)?\\s*(?:रुपये|रुपए|रुपया|rupees?|rs|हजार|हज़ार|thousand|k|सौ|लाख|lakhs?)|(?:एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|बीस|तीस|पचास|सौ)\\s+(?:रुपये|रुपए|हजार|हज़ार|लाख|सौ)");
/** Lakhs and crores are the price of a car, not what someone would pay for a safety device. */
const DO_GIVE = re("(?:मैं|मै|हम)\\s+(?:तो\\s+|भी\\s+)?(?:दे\\s+दूंगा|दे\\s+दूंगी|दूंगा|दूंगी|दे\\s+सकता|दे\\s+सकती|दे\\s+देंगे|देंगे)|i\\s+(?:would|will|can)\\s+(?:give|pay)|i'?d\\s+pay|main\\s+(?:de\\s+)?dunga");
const BIG_AMOUNT = re("लाख|लाग|lakhs?|crores?|करोड़|करोड");
const TRANSPORT_Q = re("कैसे\\s+(?:आते|जाते|ट्रेवल|ट्रैवल|travel|सफर|आना|जाना|commute)|कौन\\s*सी?\\s+(?:गाड़ी|गाडी|कार|बाइक|वाहन|vehicle|transport|साधन)|किस\\s+(?:से|साधन|गाड़ी)|(?:गाड़ी|कार|बाइक|वाहन|vehicle)\\s+(?:चलाते|चलाती|रखते|use)|how\\s+do\\s+you\\s+(?:travel|commute|get\\s+around)|which\\s+(?:vehicle|transport|car|bike)|do\\s+you\\s+(?:drive|ride|own)|what\\s+do\\s+you\\s+(?:drive|ride)|ट्रेवल\\s+करते|travel\\s+करते|आना\\s+जाना|आते\\s+जाते|कैसे\\s+जाते|रोज\\s+का\\s+सफर|आमतौर\\s+पर\\s+कैसे");

/** "How are you? – Fine." and "Can you hear me? – Yes, the weather is nice": remarks that are not about Trata. */
/** "Would you have any problem / concern with it?": a "no" to this is a yes to the product, and a "yes" is a worry. */
const PROBLEM_Q = re("कोई\\s+(?:भी\\s+)?(?:परेशानी|दिक्कत|दिकत|समस्या|प्रॉब्लम|problem|चिंता|आपत्ति|डर|इश्यू|issue|कंसर्न|concern|concerns|worry|टेंशन|tension)|(?:परेशानी|दिक्कत|समस्या|आपत्ति)\\s+(?:होगी|है|हो\\s+सकती)|any\\s+(?:problem|problems|issue|issues|concern|concerns|objection|objections|worry|worries|hesitation)|(?:does|do|would)\\s+(?:this|that|it|these)\\s+(?:worry|concern|bother|diminish)|would\\s+you\\s+mind|koi\\s+(?:bhi\\s+)?(?:dikkat|problem|pareshani|tension|concern|concerns|issue|issues|chinta|dar|worry|objection|samasya)");
const HELLO_Q = re("कैसे\\s+(?:हो|हैं)|कैसी\\s+हैं|कैसे\\s+है\\s+आप|how\\s+are\\s+you|क्या\\s+हाल|बिजी|busy|टाइम\\s+है|time\\s+है|available|फ्री\\s+हैं|आवाज|सुनाई|सुन\\s+पा|can\\s+you\\s+hear|हेलो|hello|अभी\\s+बात|बात\\s+कर\\s+सकते");
const SMALL_TALK = re("मौसम|weather|आवाज़|आवाज|सुनाई|नेटवर्क|कनेक्शन|connection|हेलो|hello|नमस्ते|नमस्कार|धन्यवाद|शुक्रिया|thank\\s+you|thanks|गुड\\s+मॉर्निंग|good\\s+morning|good\\s+evening|गुड\\s+ईवनिंग");
/** After an opinion word: "…तो बहुत हो सकता है लेकिन…", the shape of a reply, not of a question. */
const ASSERT_AFTER = re("तो\\s+(?:बहुत|काफी|ज्यादा|अच्छ|सही)|बहुत\\s+हो\\s+सकता|हो\\s+सकता\\s+है|है\\s+(?:लेकिन|पर|मगर|but)|(?:लेकिन|मगर|but)");

/** An unpunctuated run that starts as the interviewer's question can end with the customer's answer. Take an opinion word late in such a run when it reads like an answer. */
function rescuable(unit: Classified, cue: Cue, norm: string) {
  if (unit.kind !== "Q" || unit.asked || unit.words < 12 || cue.kind === "doubt") return false;
  const before = norm.slice(unit.ns, cue.start).trim().split(/\s+/u).filter(Boolean);
  if (before.length < 3) return false;
  const lastThree = before.slice(-3).join(" ");
  if (YOU.test(lastThree) || QUESTION_ANYWHERE.test(lastThree)) return false;
  return ASSERT_AFTER.test(norm.slice(cue.end, unit.ne).trim().split(/\s+/u).slice(0, 8).join(" "));
}

function buildExchanges(units: Classified[]): Exchange[] {
  const out: Exchange[] = [];
  let i = 0;
  while (i < units.length) {
    if (units[i].kind !== "Q") { i += 1; continue; }
    const q: number[] = [];
    while (i < units.length && units[i].kind === "Q" && q.length < 3) { q.push(i); i += 1; }
    const a: number[] = [];
    let words = 0;
    // A long answer runs over several customer units; each one still belongs to the question that prompted it.
    while (i < units.length && units[i].kind === "C" && a.length < 10 && words < 150) { a.push(i); words += units[i].words; i += 1; }
    if (!a.length) continue;
    out.push({ q, a, question: q.map((k) => units[k].text).join(" "), answer: a.map((k) => units[k].text).join(" ") });
  }
  return out;
}

const qNorm = (doc: Pick<Doc, "units">, exchange: Exchange) => exchange.q.map((k) => doc.units[k].n).join(" ");
export const questionKind = (doc: Pick<Doc, "units">, exchange: Exchange) => {
  const n = qNorm(doc, exchange);
  return {
    use: once(L.ASKS_ABOUT_USE).test(n), pay: once(L.ASKS_ABOUT_PAY).test(n), accident: once(L.ASKS_ABOUT_ACCIDENT).test(n),
    transport: once(TRANSPORT_Q).test(n), opinion: once(OPINION_Q).test(n),
  };
};

/** Words that name Trata or the idea itself (the ASR writes the brand several ways). Generic "यह / this" is left out on purpose. */
export const PRODUCT_CTX = re("trata|सिस्टम|तकनीक|टेक्नोलॉजी|टेक्नॉलजी|कॉन्सेप्ट|कांसेप्ट|प्रोजेक्ट|स्टार्टअप|ब्रांड|सर्विस|technology|concept|system|software|hardware|startup|brand|innovation|dispatch|ट्राटा|ट्रैटा|ट्रेटा|तराता|तरता|त्राता|ट्रटा|app|ऐप|एप|application|अप्लिकेशन|device|डिवाइस|सेंसर|sensor|idea|आइडिया|आईडिया|product|प्रोडक्ट|solution|सोल्यूशन|सॉल्यूशन|feature|फीचर|dashboard|डैशबोर्ड|इसका|इसकी|इसमें|इसे|इसको|इसके");

/**
 * Is this remark an opinion OF TRATA? Only when the remark itself names the product or idea, when it answers a question about
 * using, paying or liking the product, or when it follows the interviewer's pitch. A remark about the accident, the road or the
 * vehicle is problem talk even when it says "बढ़िया" or "परेशान": it is recorded as a concern, never as a score for Trata.
 */
function aboutTrata(doc: Pick<Doc, "units" | "exchanges">, answerOf: Map<number, Exchange>, index: number) {
  const unit = doc.units[index];
  if (PRODUCT_CTX.test(unit.n)) return true;
  if (L.ACCIDENT_NOUN_RE.test(unit.n) || L.TRANSPORT_WORDS.some((item) => item.re.test(unit.n))) return false;
  const exchange = answerOf.get(index);
  if (exchange) {
    const kind = questionKind(doc, exchange);
    if (kind.accident || kind.transport) return false;
    if (kind.use || kind.pay) return true;
    if (kind.opinion && exchange.q.some((k) => PRODUCT_CTX.test(doc.units[k].n))) return true;
  }
  const before = doc.units[index - 1];
  return before !== undefined && before.kind === "P";
}

/**
 * Is this a customer call about Trata at all? It needs the interviewer's side (questions or the pitch) and something to talk
 * about (the product, an accident, the way they travel). An article, a story or a lecture has neither, so it gets no score.
 */
export function isCustomerCall(doc: Pick<Doc, "units">) {
  const interviewer = doc.units.filter((unit) => unit.kind !== "C").length;
  const topics = doc.units.filter((unit) => PRODUCT_CTX.test(unit.n) || L.ACCIDENT_NOUN_RE.test(unit.n) || L.TRANSPORT_WORDS.some((item) => item.re.test(unit.n))).length;
  return interviewer >= 1 && topics >= 2;
}

export function buildDoc(raw: string): Doc {
  const mapped = normalizeMapped(raw);
  const { units, mode } = classify(segment(raw, mapped));
  const exchanges = buildExchanges(units);
  const base = { raw, norm: mapped.norm, map: mapped.map, units, mode, exchanges };
  const cues: UCue[] = [];
  const hasCue = new Set<number>();
  // Everything said before the product was first explained is small talk, and so are the answers to "how are you?".
  const pitchAt = units.findIndex((unit) => unit.kind === "P" && pitchScore(unit) >= 1);
  const pitched = units.filter((unit) => unit.kind === "P").length >= 2 && pitchAt >= 3;
  // Opinions of Trata only count from the moment the product is introduced. The pitch marks it best; without a pitch, the
  // first time the interviewer names the product or idea does.
  const mentionAt = units.findIndex((unit) => unit.kind !== "C" && PRODUCT_CTX.test(unit.n));
  const introAt = pitched ? pitchAt : mentionAt;
  const greeting = new Set<number>();
  for (const exchange of exchanges) if (once(HELLO_Q).test(exchange.q.map((k) => units[k].n).join(" "))) exchange.a.forEach((k) => greeting.add(k));
  const answerOf = new Map<number, Exchange>();
  for (const exchange of exchanges) for (const k of exchange.a) answerOf.set(k, exchange);
  for (const cue of findCuesNormalized(mapped.norm)) {
    const index = unitAt(units, cue.start);
    const unit = units[index];
    if (!unit || cue.start >= unit.ne) continue;
    if (introAt >= 0 && index < introAt) continue;
    if (greeting.has(index) || once(SMALL_TALK).test(unit.n)) continue;
    if (!aboutTrata(base, answerOf, index)) continue;
    if (unit.kind === "C") { cues.push({ ...cue, unit: index }); if (cue.kind !== "doubt") hasCue.add(index); }
    else if (rescuable(unit, cue, mapped.norm)) {
      const words = mapped.norm.slice(unit.ns, cue.start).trimEnd().split(/\s+/u);
      const from = cue.start - words.slice(-3).join(" ").length - 1;
      cues.push({ ...cue, weight: cue.weight * 0.7, unit: index, from: Math.max(unit.ns, from) });
    }
  }
  // "Does it seem useful?" – "Yes." is praise even though the reply has no opinion word of its own.
  for (const exchange of exchanges) {
    const kind = questionKind(base, exchange);
    const problem = once(PROBLEM_Q).test(qNorm(base, exchange)) && exchange.q.some((k) => PRODUCT_CTX.test(units[k].n));
    if (!(kind.opinion || problem) || kind.use || kind.pay || kind.accident || kind.transport) continue;
    const first = units[exchange.a[0]];
    if (exchange.a.some((k) => hasCue.has(k))) continue;
    let yes = L.AFFIRM_START.test(first.n);
    let no = !yes && L.NEGATE_START.test(first.n);
    if (!yes && !no) continue;
    if (problem) [yes, no] = [no, yes]; // "any problem with it?" – "not at all!" is praise
    const word = first.n.match(/^\S+/u)![0];
    cues.push({ text: word, value: yes ? 0.5 : -0.5, weight: 0.8, kind: yes ? "praise" : "reject", start: first.ns, end: first.ns + word.length, unit: exchange.a[0] });
  }
  cues.sort((a, b) => a.start - b.start);
  return { ...base, cues, introAt };
}

// ============================================================================ small helpers ===================
export const customerUnits = (doc: Doc) => doc.units.map((unit, index) => ({ unit, index })).filter(({ unit }) => unit.kind === "C");

export function quote(doc: Doc, index: number): Evidence {
  const unit = doc.units[index];
  return { text: unit.text.length > 580 ? unit.text.slice(0, 580) : unit.text, pos: Math.round((unit.s / Math.max(1, doc.raw.length)) * 10000) / 10000, verified: true };
}

/** The piece of the ORIGINAL text for a stretch of the normalised text. */
const rawSlice = (doc: Doc, from: number, to: number) => doc.raw.slice(doc.map[from], doc.map[to]);

/** A few words around a match, taken from the original text of the piece (`from`/`to` are positions in the normalised text). */
function around(doc: Doc, index: number, from: number, to: number, before = 5, after = 6) {
  const unit = doc.units[index];
  const base = doc.map[unit.ns];
  const text = doc.raw.slice(base, doc.map[unit.ne]);
  const tokens = Array.from(text.matchAll(/\S+/gu), (match) => ({ s: match.index!, e: match.index! + match[0].length }));
  const start = doc.map[from] - base;
  const end = doc.map[to] - base;
  let first = tokens.findIndex((token) => token.e > start);
  let last = tokens.length - 1;
  for (let k = 0; k < tokens.length; k += 1) if (tokens[k].s >= end) { last = k - 1; break; }
  if (first < 0) first = 0;
  if (last < first) last = first;
  const a = Math.max(0, first - before);
  const b = Math.min(tokens.length - 1, last + after);
  return text.slice(tokens[a].s, tokens[b].e).replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/gu, "");
}

const wordsBefore = (text: string, position: number, count: number) => text.slice(Math.max(0, position - 60), position).split(/\s+/u).filter(Boolean).slice(-count).join(" ");
const wordsAfter = (text: string, position: number, count: number) => text.slice(position, position + 60).split(/\s+/u).filter(Boolean).slice(0, count).join(" ");
// A negation only reaches across the words of its own clause: "नहीं दूंगा, बहुत महंगा" does not make "महंगा" a no.
const CLAUSE_END = /[,.;।!?]/u;
const clauseBefore = (text: string, start: number, count: number) => text.slice(0, start).split(CLAUSE_END).pop()!.trim().split(/\s+/u).slice(-count).join(" ");
const clauseAfter = (text: string, end: number, count: number) => text.slice(end).split(CLAUSE_END)[0].trim().split(/\s+/u).slice(0, count).join(" ");
const negatedNear = (text: string, start: number, end: number) => NEG.test(clauseBefore(text, start, 3)) || NEG.test(clauseAfter(text, end, 2));

// ============================================================================ would use / would pay ============
type Votes = { yes: number; no: number; maybe: number };

function collectVotes(doc: Doc, rules: L.IntentRule[] | readonly L.IntentRule[], asks: "use" | "pay"): Votes {
  const votes: Votes = { yes: 0, no: 0, maybe: 0 };
  for (const { unit, index } of customerUnits(doc)) {
    if (doc.introAt >= 0 && index < doc.introAt) continue; // said before the product was introduced
    const own = once(L.FIRST_PERSON).test(unit.n);
    const third = once(L.THIRD_PERSON).test(unit.n) && !own;
    const factor = third ? 0.25 : own ? 1 : 0.8;
    const found = { yes: 0, no: 0, maybe: 0 };
    for (const rule of rules) {
      for (const match of unit.n.matchAll(globalOf(rule.re))) {
        const start = match.index!;
        const negatedOutside = negatedNear(unit.n, start, start + match[0].length) && !NEG.test(match[0]);
        let side = rule.value;
        if (negatedOutside && rule.value === "yes") side = "no";
        else if (negatedOutside && rule.value === "no" && asks === "pay") side = "yes"; // "महंगा नहीं है": not expensive
        if (side === "maybe") found.maybe = Math.max(found.maybe, rule.weight);
        else if (side === "yes" || side === "no") found[side] = Math.max(found[side], rule.weight * factor);
      }
    }
    // "if it were cheaper I would buy it": a condition halves what follows from it.
    if (found.maybe > 0) { found.yes *= 0.5; found.no *= 0.5; }
    votes.yes += found.yes; votes.no += found.no; votes.maybe += found.maybe;
  }
  for (const exchange of doc.exchanges) {
    const kind = questionKind(doc, exchange);
    if (asks === "use" ? !kind.use : !kind.pay) continue;
    if (doc.introAt >= 0 && exchange.a[0] < doc.introAt) continue;
    const first = doc.units[exchange.a[0]];
    // "Would you have any problem installing it?" – "Not at all" is a yes to using it.
    const problem = once(PROBLEM_Q).test(qNorm(doc, exchange));
    if (L.AFFIRM_START.test(first.n)) votes[problem ? "no" : "yes"] += 1;
    else if (L.NEGATE_START.test(first.n)) votes[problem ? "yes" : "no"] += 1;
    else if (L.MAYBE_START.test(first.n)) votes.maybe += 0.6;
    if (asks === "pay") {
      if (exchange.a.some((k) => once(DO_GIVE).test(doc.units[k].n))) votes.yes += 1;
      // Naming a price they are fine with is a yes to paying; the "too expensive" patterns above already counted any refusal.
      const quoted = exchange.a.some((k) => once(PRICE_QUOTE).test(doc.units[k].n) && !once(BIG_AMOUNT).test(doc.units[k].n));
      const refused = exchange.a.some((k) => once(L.PAY_RULES[1].re).test(doc.units[k].n));
      if (quoted && !refused) votes.yes += 0.6;
    }
  }
  return votes;
}

function decide(votes: Votes): Intent {
  if (votes.yes === 0 && votes.no === 0 && votes.maybe === 0) return "unclear";
  const net = votes.yes - votes.no;
  if (votes.yes >= 0.5 && votes.no >= 0.5 && Math.abs(net) < 0.5) return "maybe";
  if (net >= 0.5) return "yes";
  if (net <= -0.5) return "no";
  return "maybe";
}

export function extractIntents(doc: Doc) {
  const use = collectVotes(doc, L.USE_RULES, "use");
  const pay = collectVotes(doc, L.PAY_RULES, "pay");
  return { wouldUse: decide(use), wouldPay: decide(pay), use, pay };
}

// ============================================================================ who is the person ===============
const ACCIDENT_LEVELS: AccidentExperience[] = ["unclear", "none", "near_miss", "minor", "serious"];
const rank = (value: AccidentExperience) => ACCIDENT_LEVELS.indexOf(value);

function severityAround(doc: Doc, index: number, fallback: "minor" | null = "minor"): "serious" | "minor" | "near_miss" | null {
  const window = [index, index + 1, index - 1].filter((k) => k >= 0 && k < doc.units.length && doc.units[k].kind === "C").map((k) => doc.units[k].n).join(" ");
  for (const level of ["serious", "near_miss", "minor"] as const) {
    const rule = L.ACCIDENT_SEVERITY.find((item) => item.level === level)!;
    if (rule.re.test(window)) return level;
  }
  return fallback;
}

export function extractAccident(doc: Doc): { value: AccidentExperience; unit: number | null; witnessed: boolean; mentioned: boolean } {
  let best: AccidentExperience = "unclear";
  let unitOf: number | null = null;
  let witnessed = false;
  let mentioned = false;
  const raise = (value: AccidentExperience, index: number) => { if (rank(value) > rank(best)) { best = value; unitOf = index; } };
  for (const { unit, index } of customerUnits(doc)) {
    if (L.ACCIDENT_NOUN_RE.test(unit.n)) mentioned = true;
    if (L.ACCIDENT_NONE.test(unit.n)) raise("none", index);
    if (L.NEAR_MISS_STRONG.test(unit.n) && !(once(L.THIRD_PERSON).test(unit.n) && !once(L.FIRST_PERSON).test(unit.n))) raise("near_miss", index);
    const saw = L.ACCIDENT_WITNESSED.test(unit.n);
    if (saw) witnessed = true;
    // "I saw an accident" is not "I was in an accident", unless the same sentence says it happened to them too.
    if (L.ACCIDENT_NOUN_RE.test(unit.n) && L.ACCIDENT_PERSONAL.test(unit.n) && !L.ACCIDENT_NONE.test(unit.n) && (!saw || L.ACCIDENT_STRONG_PERSONAL.test(unit.n))) {
      // Someone else in the family: only counted when the severity is said; for the person themselves, an accident without details is recorded as minor.
      const severity = severityAround(doc, index, L.ACCIDENT_STRONG_PERSONAL.test(unit.n) ? "minor" : null);
      if (severity) raise(severity, index);
    }
  }
  // Asked "have you been in an accident?": the answer decides, even when the reply does not repeat the word.
  for (const exchange of doc.exchanges) {
    if (!questionKind(doc, exchange).accident) continue;
    const first = doc.units[exchange.a[0]];
    const answer = exchange.a.map((k) => doc.units[k].n).join(" ");
    if (L.ACCIDENT_WITNESSED.test(answer)) witnessed = true;
    if (L.ACCIDENT_NONE.test(answer) || (L.NEGATE_START.test(first.n) && !L.ACCIDENT_PERSONAL.test(answer))) raise("none", exchange.a[0]);
    else if (L.AFFIRM_START.test(first.n) && !L.ACCIDENT_WITNESSED.test(answer)) raise(severityAround(doc, exchange.a[0]) ?? "minor", exchange.a[0]);
  }
  return { value: best, unit: unitOf, witnessed, mentioned };
}

const OWN_VEHICLE = re(`(?:मेरी|मेरा|मेरे|अपनी|अपना|my|हमारी|हमारा)${near(25)}`);

export function extractTransport(doc: Doc): Transport[] {
  const counts = new Map<Transport, number>();
  const answers = new Set<number>();
  for (const exchange of doc.exchanges) if (questionKind(doc, exchange).transport) exchange.a.forEach((k) => answers.add(k));
  for (const { unit, index } of customerUnits(doc)) {
    const accident = L.ACCIDENT_NOUN_RE.test(unit.n);
    const own = once(OWN_VEHICLE).test(unit.n);
    const self = once(L.SELF_WORDS).test(unit.n) || L.TRAVEL_VERBS.test(unit.n);
    const asked = answers.has(index);
    if (!asked && !(self && (!accident || own))) continue;
    if (!asked && once(L.THIRD_PERSON).test(unit.n) && !once(L.FIRST_PERSON).test(unit.n)) continue;
    for (const item of L.TRANSPORT_WORDS) {
      const pattern = globalOf(item.re);
      for (const match of unit.n.matchAll(pattern)) {
        if (wordsAfter(unit.n, match.index! + match[0].length, 2).match(NEG)) continue; // "गाड़ी नहीं है"
        if (aboutOthers(unit.n, match.index!)) continue; // "my friends who run a taxi fleet"
        counts.set(item.mode, (counts.get(item.mode) ?? 0) + (asked ? 2 : 1));
        break;
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([mode]) => mode);
}

/** "my friends who run a taxi fleet", "मेरे भाई ट्रक चलाते हैं": what comes right after these words is about someone else. */
const OTHERS_BEFORE = re(`friends?|दोस्त|दोस्तों|brothers?|भाई|uncle|अंकल|relatives?|रिश्तेदार|cousins?|कजिन|neighbou?rs?|पड़ोसी|father|dad|पापा|पिताजी|बेटा|son|who\\s+(?:run|runs|own|owns|drive|drives)|जो\\s+(?:चलाते|चलाता|चलाती)|they|उनके|उनका|उनकी|unke|unka|someone|people|लोग|log|colleagues?|साथी`);
/** True when the words just before position `at` in `text` (same clause) name someone other than the speaker. */
function aboutOthers(text: string, at: number) {
  const before = text.slice(Math.max(0, at - 45), at).split(/[,.;।!?]/u).pop() ?? "";
  return once(OTHERS_BEFORE).test(before);
}

export function extractRole(doc: Doc, transport: Transport[]): Role {
  const order: Array<[Role, RegExp[]]> = [
    ["fleet_owner", L.ROLE_PATTERNS.fleet_owner], ["professional_driver", L.ROLE_PATTERNS.professional_driver],
    ["safety_professional", L.ROLE_PATTERNS.safety_professional], ["private_driver", L.ROLE_PATTERNS.private_driver],
    ["passenger", L.ROLE_PATTERNS.passenger], ["other", L.ROLE_PATTERNS.other],
  ];
  const texts = customerUnits(doc).map(({ unit }) => unit.n);
  // A role counts only when it is about the speaker: "my friends who run a taxi fleet" does not make them a fleet owner.
  const said = (pattern: RegExp) => texts.some((text) => Array.from(text.matchAll(globalOf(pattern))).some((match) => !aboutOthers(text, match.index!)));
  for (const [role, patterns] of order) if (patterns.some(said)) return role;
  if (transport.some((mode) => mode === "car" || mode === "two_wheeler") && customerUnits(doc).some(({ unit }) => L.TRAVEL_VERBS.test(unit.n))) return "private_driver";
  if (transport.length && transport.every((mode) => ["public_transport", "bus", "auto_rickshaw", "cab_taxi", "walks", "bicycle"].includes(mode))) return "passenger";
  return "unclear";
}

// ============================================================================ features =========================
export type FeatureRow = FeatureOpinion & { unit: number };
const PRONOUN_START = re("ये|यह|इसका|इसकी|इसके|इसमें|इसे|this|that|it|वो|वह|ये सब|इन्हें|इसलिए");

export function extractFeatures(doc: Doc): FeatureRow[] {
  const rows: FeatureRow[] = [];
  const valuesByUnit = new Map<number, number[]>();
  for (const cue of doc.cues) if (cue.kind !== "doubt") valuesByUnit.set(cue.unit, [...(valuesByUnit.get(cue.unit) ?? []), cue.value]);

  const addRow = (feature: string, index: number, values: number[], unitNorm: string, extra: { affirm?: boolean; deny?: boolean } = {}) => {
    const request = once(L.REQUESTS).test(unitNorm);
    const confused = once(L.CONFUSED).test(unitNorm);
    const list = [...values];
    if (extra.affirm) list.push(0.5);
    if (extra.deny) list.push(-0.5);
    if (!list.length && !request && !confused) return;
    const positives = list.filter((v) => v > POSITIVE_CUE);
    const negatives = list.filter((v) => v < -POSITIVE_CUE);
    const mean = list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0;
    let stance: Stance;
    let score: number;
    if (positives.length && negatives.length) { stance = "mixed"; score = mean; }
    else if (mean >= POSITIVE_CUE) { stance = "positive"; score = mean; }
    else if (mean <= -POSITIVE_CUE) { stance = "negative"; score = mean; }
    else if (request) { stance = "request"; score = 0.3; }
    else if (confused) { stance = "confused"; score = -0.1; }
    else { stance = "neutral"; score = mean; }
    const importance: Importance = once(L.MUST_HAVE).test(unitNorm) ? "must_have" : once(L.NICE_TO_HAVE).test(unitNorm) ? "nice_to_have" : "unclear";
    rows.push({ name: feature, stance, score: Math.round(Math.max(-1, Math.min(1, score)) * 1000) / 1000, importance, evidence: quote(doc, index), unit: index });
  };

  const handled = new Set<string>();
  for (const { unit, index } of customerUnits(doc)) {
    const hits = L.FEATURES.filter((feature) => feature.re.test(unit.n));
    if (!hits.length) continue;
    // The opinion may sit in the next short piece: "...एम्बुलेंस अपने आप बुलाएगा। यह बहुत जरूरी है।"
    const next = doc.units[index + 1];
    const follows = next && next.kind === "C" && next.words <= 14 && once(PRONOUN_START).test(next.n);
    const values = [...(valuesByUnit.get(index) ?? []), ...(follows ? valuesByUnit.get(index + 1) ?? [] : [])];
    const norm = follows ? `${unit.n} ${next.n}` : unit.n;
    for (const feature of hits) {
      // Price words alone are not a feature opinion; the pricing topic and the mentions board cover them.
      if (feature.name === "Pricing model" && !values.length) continue;
      addRow(feature.name, index, values, norm);
      handled.add(`${feature.name}:${index}`);
    }
  }
  // "Is it important that an ambulance is called automatically?" – "Yes, very."
  for (const exchange of doc.exchanges) {
    const kind = questionKind(doc, exchange);
    if (kind.use || kind.pay || kind.accident || kind.transport) continue;
    const question = qNorm(doc, exchange);
    const first = doc.units[exchange.a[0]];
    // "Any concern with the sensors?" – "No": a no to a problem question is a yes to the feature, as in the intent votes.
    const problem = once(PROBLEM_Q).test(question);
    const yes = L.AFFIRM_START.test(first.n);
    const no = !yes && L.NEGATE_START.test(first.n);
    const affirm = problem ? no : yes;
    const deny = problem ? yes : no;
    for (const feature of L.FEATURES) {
      if (feature.name === "Pricing model" || !feature.re.test(question)) continue;
      const index = exchange.a.find((k) => !handled.has(`${feature.name}:${k}`));
      if (index === undefined) continue;
      const values = exchange.a.flatMap((k) => valuesByUnit.get(k) ?? []);
      addRow(feature.name, index, values, exchange.a.map((k) => doc.units[k].n).join(" "), { affirm: affirm && !values.length, deny: deny && !values.length });
    }
  }
  return rows;
}

export function mergeFeatures(rows: FeatureRow[]): FeatureOpinion[] {
  const by = new Map<string, FeatureRow[]>();
  for (const row of rows) by.set(row.name, [...(by.get(row.name) ?? []), row]);
  const merged: FeatureOpinion[] = [];
  for (const [name, list] of by) {
    const stances = new Set(list.map((row) => row.stance).filter((stance) => stance !== "neutral"));
    const score = list.reduce((s, row) => s + row.score, 0) / list.length;
    const strongest = [...list].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
    const importance: Importance = list.some((row) => row.importance === "must_have") ? "must_have" : list.some((row) => row.importance === "nice_to_have") ? "nice_to_have" : "unclear";
    const only = [...stances];
    const stance: Stance = only.length === 0 ? "neutral" : only.length === 1 ? only[0] : only.length === 2 && only.includes("request") && only.includes("positive") ? "positive" : "mixed";
    merged.push({ name, stance, score: Math.round(score * 1000) / 1000, importance, evidence: strongest.evidence, count: list.length });
  }
  return merged.sort((a, b) => (b.count ?? 1) - (a.count ?? 1) || Math.abs(b.score) - Math.abs(a.score));
}

// ============================================================================ mentions and alternatives ========
const TYPE_ORDER: MentionType[] = ["competitor", "pricing", "privacy_concern", "objection", "feature_request", "suggestion", "pain_point", "use_case", "promise", "other"];
const TYPE_CAP: Record<MentionType, number> = { competitor: 6, pricing: 8, privacy_concern: 4, objection: 6, feature_request: 6, suggestion: 6, pain_point: 6, use_case: 5, promise: 3, other: 4 };
const TEXT = {
  en: { today: "Today they rely on", carmaker: "Car-maker built-in SOS" },
  hi: { today: "अभी वे इस पर निर्भर हैं", carmaker: "कार कंपनी का इनबिल्ट SOS" },
} as const;

function keywordsOf(doc: Doc, index: number, pattern: RegExp, limit = 4) {
  const unit = doc.units[index];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of unit.n.matchAll(globalOf(pattern))) {
    const text = rawSlice(doc, unit.ns + match.index!, unit.ns + match.index! + match[0].length).trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/** "My car already has SOS": a product they own, so an SOS mention there is a competitor, not a request. */
const OWNS_ALREADY = re(`already|पहले\\s+से|pehle\\s+se|built[-\\s]?in|inbuilt|इनबिल्ट|comes\\s+with|(?:my|मेरी|मेरे)\\s+(?:car|गाड़ी|कार)\\s+(?:has|में\\s+है)`);
/** A request that names a thing to add, even when it is not one of Trata's listed features (an SOS button, a helmet sensor). */
const REQUEST_THING = re(`इसमें|साथ\\s+में|और\\s+एक|should\\s+(?:also|be|have)|there\\s+should|add|button|बटन|option|ऑप्शन|feature|फीचर|फ़ीचर|mode|मोड|चाहिए|chahiye|होना\\s+चाहिए|hona\\s+chahiye`);

export function extractMentions(doc: Doc, lang: "en" | "hi" = "en"): { mentions: Mention[]; alternatives: string[] } {
  const candidates: Array<{ type: MentionType; text: string; unit: number }> = [];
  const alternatives: string[] = [];
  const seenKey = new Set<string>();
  const add = (type: MentionType, text: string, unit: number) => {
    const key = type === "competitor" ? `${type}:${text}` : `${type}:${unit}`;
    const cleaned = clip(text, 160);
    if (!cleaned || seenKey.has(key)) return;
    seenKey.add(key);
    candidates.push({ type, text: cleaned, unit });
  };
  const addAlternative = (name: string) => { if (!alternatives.includes(name)) alternatives.push(name); };

  const people = customerUnits(doc);
  for (const { unit, index } of people) {
    if (unit.words < 4) continue;
    let taken = 0;
    const text = unit.n;

    // --- products and habits already in their life
    const names: string[] = [];
    const asking = L.REQUESTS.test(text) && !once(OWNS_ALREADY).test(text);
    for (const item of L.ALTERNATIVES) {
      if (!item.re.test(text)) continue;
      // "There should be an SOS button" asks for a feature; it is not a product they already have.
      if (asking && item.name === "Car-maker built-in SOS") continue;
      addAlternative(item.name);
      if (item.kind === "competitor") names.push(item.name);
    }
    for (const maker of text.matchAll(globalOf(L.CARMAKERS))) {
      const neighbours = [index - 1, index, index + 1].filter((k) => k >= 0 && k < doc.units.length && doc.units[k].kind === "C").map((k) => doc.units[k].n).join(" ");
      if (!L.CRASH_HELP.test(neighbours)) break;
      const label = `${TEXT[lang].carmaker} (${rawSlice(doc, unit.ns + maker.index!, unit.ns + maker.index! + maker[0].length)})`;
      names.push(label);
      addAlternative(label);
      break;
    }
    if (names.length) { add("competitor", names.join(", "), index); taken += 1; }

    for (const trigger of L.MENTION_TRIGGERS) {
      if (taken >= 3) break;
      if (trigger.type === "competitor") {
        if (names.length || !trigger.re.test(text)) continue;
        const match = globalOf(trigger.re).exec(text)!;
        add("competitor", around(doc, index, unit.ns + match.index, unit.ns + match.index + match[0].length), index);
        taken += 1;
        continue;
      }
      const match = globalOf(trigger.re).exec(text);
      if (!match) continue;
      const start = unit.ns + match.index;
      const end = start + match[0].length;
      if (trigger.type === "feature_request" && !(L.FEATURES.some((feature) => feature.re.test(text)) || once(REQUEST_THING).test(text))) continue;
      if (trigger.type === "pricing") {
        const amount = globalOf(PRICE_QUOTE).exec(text);
        const at = amount ?? match;
        const from = unit.ns + at.index;
        add("pricing", around(doc, index, from, from + at[0].length, 5, 6), index);
      } else if (trigger.type === "privacy_concern") {
        add("privacy_concern", around(doc, index, start, end, 4, 5), index);
      } else {
        add(trigger.type, around(doc, index, start, end), index);
      }
      taken += 1;
    }
    if (!taken && unit.words >= 8) {
      for (const item of L.INTERESTING) {
        if (item.label === "number") continue;
        const match = globalOf(item.re).exec(text);
        if (!match) continue;
        add("other", around(doc, index, unit.ns + match.index, unit.ns + match.index + match[0].length, 5, 7), index);
        break;
      }
    }
  }
  // Habits are worth a line of their own: "what they do today instead".
  for (const { unit, index } of people) {
    for (const item of L.ALTERNATIVES) {
      if (item.kind !== "habit" || !item.re.test(unit.n)) continue;
      const match = globalOf(item.re).exec(unit.n)!;
      add("other", `${TEXT[lang].today}: ${rawSlice(doc, unit.ns + match.index, unit.ns + match.index + match[0].length)}`, index);
    }
  }

  const perType = new Map<MentionType, number>();
  const mentions: Mention[] = [];
  const ordered = [...candidates].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.unit - b.unit);
  const lastUnit = new Map<MentionType, number>();
  for (const item of ordered) {
    const used = perType.get(item.type) ?? 0;
    if (used >= TYPE_CAP[item.type] || mentions.length >= 40) continue;
    // Two neighbouring pieces about the same thing are one remark that the transcript happened to cut in two.
    const previous = lastUnit.get(item.type);
    if (previous !== undefined && item.unit - previous <= 1 && item.type !== "competitor") continue;
    lastUnit.set(item.type, item.unit);
    perType.set(item.type, used + 1);
    mentions.push({ type: item.type, text: item.text, evidence: quote(doc, item.unit) });
  }
  return { mentions, alternatives: alternatives.slice(0, 10) };
}

// ============================================================================ concern, understanding, key points ====
const CONCERN_CONTEXT = re(`${L.ACCIDENT_NOUN}|सड़क|रोड|road|ट्रैफिक|traffic|सेफ्टी|safety|सुरक्षा|मौत|death|जान|एम्बुलेंस|ambulance|हाईवे|highway|ड्राइविंग|driving|गाड़ी|गाडी|वाहन`);

export function extractConcern(doc: Doc, accident: ReturnType<typeof extractAccident>, painPoints: number): { level: Level; unit: number | null } {
  let level: Level = "none";
  let unit: number | null = null;
  const up = (to: Level, index: number | null) => { if (L_ORDER.indexOf(to) > L_ORDER.indexOf(level)) { level = to; unit = index; } };
  if (accident.value === "serious") up("high", accident.unit);
  else if (accident.value === "minor" || accident.value === "near_miss") up("medium", accident.unit);
  for (const { unit: u, index } of customerUnits(doc)) {
    const context = once(CONCERN_CONTEXT).test(u.n);
    if (!context) continue;
    if (once(L.CONCERN_HIGH).test(u.n)) up("high", index);
    else if (once(L.CONCERN_MEDIUM).test(u.n)) up("medium", index);
    else if (once(L.CONCERN_LOW).test(u.n)) up("low", index);
  }
  if (painPoints > 0) up("medium", unit);
  if (accident.mentioned || accident.witnessed) up("medium", unit);
  return { level, unit };
}
const L_ORDER: Level[] = ["none", "low", "medium", "high"];

export function extractUnderstanding(doc: Doc, features: FeatureOpinion[]): Understanding {
  let confused = 0, how = 0, restated = 0;
  for (const { unit } of customerUnits(doc)) {
    if (once(L.CONFUSED).test(unit.n)) confused += 1;
    if (once(L.HOW_QUESTION).test(unit.n)) how += 1;
    if (once(L.STRONG_PRAISE_FOR_UNDERSTANDING).test(unit.n)) restated += 1;
  }
  const praised = doc.cues.some((cue) => cue.value > 0 && cue.kind !== "doubt");
  const signs = (restated > 0 ? 1 : 0) + (features.length >= 1 ? 1 : 0) + (praised ? 1 : 0);
  if (confused > 0 && signs <= 1) return "confused";
  if (confused > 0 || how > 0) return "partial";
  if (signs >= 2) return "clear";
  if (signs === 1) return "partial";
  return "unclear";
}

export function extractKeyPoints(doc: Doc, mentions: Mention[], limit = 6): string[] {
  const mentioned = new Map<string, number>();
  for (const mention of mentions) if (mention.evidence) mentioned.set(mention.evidence.text, (mentioned.get(mention.evidence.text) ?? 0) + 1);
  const scores = customerUnits(doc).map(({ unit, index }) => {
    let score = 0;
    for (const cue of doc.cues) if (cue.unit === index && cue.kind !== "doubt") score += Math.abs(cue.value * cue.weight);
    score += (mentioned.get(unit.text) ?? 0) * 0.6;
    if (L.FEATURES.some((feature) => feature.name !== "Pricing model" && feature.re.test(unit.n))) score += 0.3;
    if (L.USE_RULES.some((rule) => rule.re.test(unit.n)) || L.PAY_RULES.some((rule) => rule.re.test(unit.n))) score += 0.5;
    if (once(PRICE_QUOTE).test(unit.n)) score += 0.3;
    if (unit.words < 6) score = 0;
    return { unit, index, score };
  }).filter((item) => item.score > 0);
  const seen = new Set<string>();
  const top = scores.sort((a, b) => b.score - a.score).filter(({ unit }) => {
    const key = unit.n.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit).sort((a, b) => a.index - b.index);
  if (top.length) return top.map(({ unit }) => clip(unit.text, 240));
  return customerUnits(doc).filter(({ unit }) => unit.words >= 8).slice(0, 3).map(({ unit }) => clip(unit.text, 240));
}

// ============================================================================ question-and-answer list =========
export type QaRow = { question: string; answer: string; tone: Tone; evidence: Evidence | null };

export function extractQa(doc: Doc, limit = 12): QaRow[] {
  const rows: Array<QaRow & { weight: number; at: number }> = [];
  for (const exchange of doc.exchanges) {
    const kind = questionKind(doc, exchange);
    const cues = doc.cues.filter((cue) => exchange.a.includes(cue.unit) && cue.kind !== "doubt");
    const factOnly = (kind.transport || kind.accident) && !kind.opinion && !cues.length;
    let tone: Tone;
    if (factOnly) tone = "none";
    else if (cues.length) {
      const pos = cues.filter((cue) => cue.value > POSITIVE_CUE).length;
      const neg = cues.filter((cue) => cue.value < -POSITIVE_CUE).length;
      const mean = cues.reduce((s, cue) => s + cue.value * cue.weight, 0) / cues.reduce((s, cue) => s + cue.weight, 0);
      tone = pos && neg && Math.min(pos, neg) / Math.max(pos, neg) >= 0.5 ? "mixed" : mean >= POSITIVE_CUE ? "positive" : mean <= -POSITIVE_CUE ? "negative" : "neutral";
    } else {
      const first = doc.units[exchange.a[0]].n;
      tone = (kind.use || kind.pay) ? (L.AFFIRM_START.test(first) ? "positive" : L.NEGATE_START.test(first) ? "negative" : L.MAYBE_START.test(first) ? "mixed" : "neutral") : "neutral";
    }
    const strongest = [...cues].sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))[0];
    const evidenceAt = strongest ? strongest.unit : exchange.a[0];
    const topical = kind.use || kind.pay || kind.accident || kind.transport || kind.opinion || L.FEATURES.some((feature) => feature.re.test(qNorm(doc, exchange)));
    const answerWords = exchange.a.reduce((s, k) => s + doc.units[k].words, 0);
    const questionWords = exchange.q.reduce((s, k) => s + doc.units[k].words, 0);
    if (answerWords < 2 || (questionWords < 3 && !topical)) continue;
    rows.push({
      question: clip(exchange.question, 200), answer: clip(exchange.answer, 300), tone, evidence: quote(doc, evidenceAt),
      weight: (topical ? 2 : 0) + (cues.length ? 1 : 0) + Math.min(answerWords / 40, 1), at: exchange.a[0],
    });
  }
  return rows.sort((a, b) => b.weight - a.weight).slice(0, limit).sort((a, b) => a.at - b.at).map(({ weight: _weight, at: _at, ...row }) => row);
}
