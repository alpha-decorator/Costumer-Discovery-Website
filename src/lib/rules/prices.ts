/**
 * Prices said in the call, as numbers: "I can pay 1500 for the device and 99 a month", "3000 a year is too much",
 * "दो हज़ार तक दे दूंगा", "saal ka 500 chalega". Each amount gets a period (one-time / month / year), what the customer
 * thinks of it (accepts, too high, suggests, just mentioned) and, for "up to 2000" / "more than 3000", whether it is a limit.
 *
 * Only money counts: an amount needs a currency word, a "thousand / सौ / हज़ार" multiplier, or a price question / pay word in
 * the same sentence. Car prices (lakhs, crores), years ("2 साल पहले"), minutes and distances are left out.
 */
import type { Evidence, PricePeriod, PricePoint, PriceStance } from "@/lib/trata";
import { normalizePattern, once, rx } from "./text";
import { WORD, WORD_END } from "@/lib/call-sentiment";
import { quote, questionKind, type Doc } from "./extract";
import * as L from "./lexicon";

const W = WORD;
const E = WORD_END;
const r = (body: string) => rx(`${W}(?:${normalizePattern(body)})${E}`, "u");

const CURRENCY = "₹|rs\\.?|inr|/-|rupees?|rupaye|rupaiye|rupay|rupiya|रुपये|रुपए|रुपया|रूपये|रूपए|रु\\.?|bucks";
const MULTIPLIER: Record<string, number> = {
  k: 1000, thousand: 1000, "हजार": 1000, "हज़ार": 1000, hazaar: 1000, hazar: 1000, hajar: 1000,
  hundred: 100, "सौ": 100, sau: 100,
};
const WORD_NUMBER: Record<string, number> = {
  "एक": 1, ek: 1, one: 1, "दो": 2, do: 2, two: 2, "तीन": 3, teen: 3, tin: 3, three: 3, "चार": 4, char: 4, chaar: 4, four: 4,
  "पांच": 5, "पाँच": 5, paanch: 5, panch: 5, five: 5, "छह": 6, "छः": 6, chhe: 6, six: 6, "सात": 7, saat: 7, seven: 7,
  "आठ": 8, aath: 8, eight: 8, "नौ": 9, nau: 9, nine: 9, "दस": 10, das: 10, ten: 10, "बीस": 20, bees: 20, twenty: 20,
  "पच्चीस": 25, pachchees: 25, "तीस": 30, tees: 30, thirty: 30, "चालीस": 40, chalis: 40, forty: 40, "पचास": 50, pachas: 50,
  pachaas: 50, fifty: 50, "सौ": 100, sau: 100, hundred: 100, "डेढ़": 1.5, "डेढ": 1.5, dedh: 1.5, "ढाई": 2.5, dhai: 2.5,
};

const MULT_WORDS = Object.keys(MULTIPLIER).map((w) => w.replace(/\./g, "\\.")).join("|");
const NUM_WORDS = Object.keys(WORD_NUMBER).join("|");
/** 1500 · 1,500 · 1.5k · ₹ 99 · 2 हज़ार · do hazaar · डेढ़ हज़ार · पचास रुपये */
const AMOUNT = rx(
  `(?:(?:${CURRENCY})\\s*)?(?:(?<digits>[0-9][0-9,]*(?:\\.[0-9]+)?)|(?<word>${normalizePattern(NUM_WORDS)}))\\s*(?<mult>${normalizePattern(MULT_WORDS)})?${E}\\s*(?<cur>${normalizePattern(CURRENCY)})?`,
  "gu",
);
/** Words right after a number that make it NOT a price. */
const NOT_MONEY_AFTER = r("minutes?|mins?|मिनट|seconds?|सेकंड|hours?|घंटे|घंटा|km|kms|किमी|किलोमीटर|kilometers?|meters?|मीटर|cc|kmph|years?\\s+ago|साल\\s+पहले|saal\\s+pehle|साल\\s+से|saal\\s+se|people|लोग|log|लोगों|%|percent|प्रतिशत|बार|times|baar|cars?|गाड़ियां|गाड़ियों|गाड़ी|vehicles?|trucks?|ट्रक|बच्चे|kids|din|दिन|days?|weeks?|हफ्ते|lakh|lakhs|लाख|crores?|करोड़|करोड|th|st|nd|rd|am|pm|बजे|baje|ka\\s+accident|accidents?");
const BIG = r("लाख|lakhs?|crores?|करोड़|करोड");
const PAY_CONTEXT = r(`pay|paying|price|pricing|cost|costs|fee|fees|charge|subscription|afford|expensive|cheap|costly|worth|budget|कीमत|दाम|प्राइस|फीस|पैसे|पैसा|खर्च|खर्चा|महंगा|महंगी|सस्ता|सस्ती|सब्सक्रिप्शन|दूंगा|दूंगी|देंगे|दे\\s+दूंगा|दे\\s+सकता|दे\\s+सकती|चलेगा|paise|paisa|kharcha|keemat|daam|mehnga|sasta|dunga|denge|de\\s+dunga|chalega`);

const PERIOD_MONTH = r("per\\s+month|a\\s+month|monthly|month|months|/month|/mo|pm|p\\.m\\.|महीना|महीने|महीनेका|मासिक|मंथली|mahina|mahine|mahine\\s+ka|har\\s+mahine|हर\\s+महीने");
const PERIOD_YEAR = r("per\\s+year|a\\s+year|yearly|annual|annually|year|years|/year|/yr|p\\.a\\.|pa|साल|सालाना|वार्षिक|ईयरली|इयरली|saal|sal|saalana|har\\s+saal|हर\\s+साल");
const PERIOD_ONCE = r("one[\\s-]?time|onetime|once|lifetime|एक\\s+बार|ek\\s+baar|वन[\\s-]?टाइम|device|डिवाइस|installation|इंस्टॉलेशन|install|इंस्टॉल|hardware|हार्डवेयर|sensor|सेंसर|unit|यूनिट|खरीदने|kharidne|buy|purchase");

const TOO_HIGH = r(`too\\s+(?:much|expensive|costly|high|steep)|expensive|costly|overpriced|steep|महंगा|महंगी|महँगा|ज़्यादा|ज्यादा|zyada|jyada|jada|mehnga|mehenga|mahanga|nahi\\s+dunga|नहीं\\s+दूंगा|नहीं\\s+दे\\s+(?:सकता|सकती|पाऊंगा|पाएंगे)|won'?t\\s+pay|can'?t\\s+(?:pay|afford)|cannot\\s+(?:pay|afford)|not\\s+(?:pay|worth)|बहुत\\s+है|bahut\\s+hai|out\\s+of\\s+(?:my\\s+)?budget|बजट\\s+से\\s+बाहर`);
const ACCEPTS = r(`can\\s+(?:easily\\s+)?pay|will\\s+pay|would\\s+pay|i'?d\\s+pay|i'?ll\\s+pay|happy\\s+to\\s+pay|ready\\s+to\\s+pay|willing\\s+to\\s+pay|pay\\s+(?:around|about|up\\s+to)|is\\s+(?:fine|ok|okay|reasonable|affordable|good|fair)|(?:fine|ok|okay|reasonable|affordable|fair|acceptable)|worth|चलेगा|चल\\s+जाएगा|ठीक|सही|वाजिब|दे\\s+दूंगा|दे\\s+दूंगी|दे\\s+सकता|दे\\s+सकती|दे\\s+देंगे|दूंगा|दूंगी|देंगे|तैयार|de\\s+dunga|de\\s+dungi|de\\s+sakta|de\\s+sakti|de\\s+denge|dunga|chalega|chal\\s+jayega|theek|thik|sahi|affordable\\s+hai`);
const LIMIT_MAX = r(`up\\s*to|upto|max(?:imum)?|at\\s+most|not\\s+more\\s+than|no\\s+more\\s+than|तक|tak|से\\s+ज़्यादा\\s+नहीं|से\\s+ज्यादा\\s+नहीं|se\\s+zyada\\s+nahi|ज़्यादा\\s+से\\s+ज़्यादा|ज्यादा\\s+से\\s+ज्यादा|zyada\\s+se\\s+zyada|within|under|below|से\\s+कम|se\\s+kam`);
const MORE_THAN = r(`more\\s+than|above|over|beyond|से\\s+ज़्यादा|से\\s+ज्यादा|se\\s+zyada|se\\s+jyada|से\\s+ऊपर|se\\s+upar`);
const SUGGESTS = r(`should\\s+be|should\\s+cost|keep\\s+it|charge|रखो|रखिए|रखें|रखना\\s+चाहिए|होना\\s+चाहिए|होनी\\s+चाहिए|hona\\s+chahiye|honi\\s+chahiye|rakho|rakhiye|rakhna`);
const NEGATOR = r("नहीं|नही|not|no|never|can't|cannot|won't|nahi|nahin");

const BOUNDARY = /[.!?।\n]/u;
const CLAUSE = /[,;]|\s(?:and|but|लेकिन|पर|मगर|aur|और|or|या)\s/u;

/** The sentence and the clause (comma / "and" / "but" piece) around a stretch of the unit's normalised text. */
function around(text: string, start: number, end: number) {
  let s = start; while (s > 0 && !BOUNDARY.test(text[s - 1])) s -= 1;
  let e = end; while (e < text.length && !BOUNDARY.test(text[e])) e += 1;
  const sentence = text.slice(s, e);
  const parts: Array<[number, number]> = [];
  let from = 0;
  const pieces = sentence.split(CLAUSE);
  for (const piece of pieces) { const at = sentence.indexOf(piece, from); parts.push([at, at + piece.length]); from = at + piece.length; }
  const rel = start - s;
  const own = parts.find(([a, b]) => rel >= a && rel < b) ?? [0, sentence.length];
  return { sentence, clause: sentence.slice(own[0], own[1]), before: text.slice(Math.max(s, start - 30), start), after: text.slice(end, Math.min(e, end + 30)) };
}

function periodOf(after: string, before: string, sentence: string): PricePeriod {
  const near = `${before} ${after}`;
  if (once(PERIOD_MONTH).test(near)) return "month";
  if (once(PERIOD_YEAR).test(near)) return "year";
  if (once(PERIOD_ONCE).test(near)) return "one_time";
  if (once(PERIOD_MONTH).test(sentence) && !once(PERIOD_YEAR).test(sentence)) return "month";
  if (once(PERIOD_YEAR).test(sentence) && !once(PERIOD_MONTH).test(sentence)) return "year";
  return "unspecified";
}

function stanceOf(clause: string, sentence: string, before: string): { stance: PriceStance; limit?: "max" | "min" } {
  const limit = once(MORE_THAN).test(before) ? "max" as const : once(LIMIT_MAX).test(`${before} ${clause}`) ? "max" as const : undefined;
  // "2k is too much, maybe 500 a month max": a limit in the amount's own clause is what the customer accepts.
  if (limit && !once(MORE_THAN).test(before) && !once(TOO_HIGH).test(clause)) return { stance: once(SUGGESTS).test(clause) ? "suggests" : "accepts", limit };
  for (const text of [clause, sentence]) {
    if (once(TOO_HIGH).test(text)) return { stance: "too_high", ...(limit ? { limit } : {}) };
    if (once(SUGGESTS).test(text)) return { stance: "suggests", ...(limit ? { limit } : {}) };
    if (once(ACCEPTS).test(text)) return { stance: once(NEGATOR).test(text) && !/(?:दिक्कत|problem|issue)/u.test(text) ? "too_high" : "accepts", ...(limit ? { limit } : {}) };
  }
  return { stance: "mentioned", ...(limit ? { limit } : {}) };
}

function amountOf(groups: Record<string, string | undefined>): number | null {
  const base = groups.digits ? Number(groups.digits.replace(/,/g, "")) : groups.word ? WORD_NUMBER[groups.word] : NaN;
  if (!Number.isFinite(base)) return null;
  const mult = groups.mult ? MULTIPLIER[groups.mult] ?? 1 : 1;
  return Math.round(base * mult * 100) / 100;
}

const asked = (doc: Doc) => {
  const pay = new Set<number>();
  for (const exchange of doc.exchanges) if (questionKind(doc, exchange).pay) exchange.a.forEach((k) => pay.add(k));
  return pay;
};

/** Every price in the call, customer-side first, then prices the interviewer named that the customer answered. */
export function extractPrices(doc: Doc, limit = 12): PricePoint[] {
  const out: PricePoint[] = [];
  const payAnswers = asked(doc);
  const seen = new Set<string>();
  const push = (point: PricePoint) => {
    const key = `${point.amount}:${point.period}`;
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(point);
  };

  const read = (index: number, who: "customer" | "interviewer") => {
    const unit = doc.units[index];
    const text = unit.n;
    const found: Array<{ amount: number; start: number; end: number; period: PricePeriod; around: ReturnType<typeof around> }> = [];
    for (const match of text.matchAll(AMOUNT)) {
      const groups = match.groups ?? {};
      const start = match.index!;
      const end = start + match[0].trimEnd().length;
      const amount = amountOf(groups);
      if (amount === null || amount <= 0) continue;
      const tail = text.slice(end, end + 18);
      if (once(NOT_MONEY_AFTER).test(tail.trimStart().split(/\s+/u).slice(0, 2).join(" ")) && !groups.cur) continue;
      if (once(BIG).test(tail.split(/\s+/u).slice(0, 2).join(" "))) continue;
      const lead = text.slice(Math.max(0, start - 8), start);
      const hasCurrency = !!groups.cur || /(?:₹|rs\.?|inr)\s*$/u.test(lead) || /^(?:₹|rs|inr)/u.test(match[0]);
      const ctx = around(text, start, end);
      const money = hasCurrency || !!groups.mult || ((who === "interviewer" || payAnswers.has(index) || once(PAY_CONTEXT).test(ctx.sentence)) && !!groups.digits);
      if (!money) continue;
      // A bare word number ("एक", "do") is only money with a multiplier or a currency word next to it.
      if (groups.word && !groups.mult && !groups.cur) continue;
      // A four-digit year (2019, 2025) with no currency is a date.
      if (!hasCurrency && !groups.mult && /^(?:19|20)\d\d$/u.test(groups.digits ?? "")) continue;
      if (amount >= 100000) continue; // a car, not a safety device
      found.push({ amount, start, end, period: periodOf(ctx.after, ctx.before, ctx.sentence), around: ctx });
    }
    return found;
  };

  for (let index = 0; index < doc.units.length; index += 1) {
    const unit = doc.units[index];
    if (unit.kind !== "C" || (doc.introAt >= 0 && index < doc.introAt)) continue;
    for (const item of read(index, "customer")) {
      const { stance, limit: edge } = stanceOf(item.around.clause, item.around.sentence, item.around.before);
      push({ amount: item.amount, period: item.period, stance, ...(edge ? { limit: edge } : {}), who: "customer", text: clip(doc, index, item.start, item.end), evidence: quote(doc, index) });
    }
  }
  // "Would you pay 1500 a year?" – "Yes." The interviewer named the price; the answer says what the customer thinks of it.
  for (const exchange of doc.exchanges) {
    if (!questionKind(doc, exchange).pay) continue;
    const first = doc.units[exchange.a[0]];
    const answer = exchange.a.map((k) => doc.units[k].n).join(" ");
    const yes = L.AFFIRM_START.test(first.n) || once(L.PAY_RULES[0].re).test(answer);
    const no = L.NEGATE_START.test(first.n) || once(L.PAY_RULES[1].re).test(answer);
    const stance: PriceStance = no && !yes ? "too_high" : yes && !no ? "accepts" : "mentioned";
    for (const k of exchange.q) {
      for (const item of read(k, "interviewer")) {
        push({ amount: item.amount, period: item.period, stance, who: "interviewer", text: clip(doc, k, item.start, item.end), evidence: quote(doc, exchange.a[0]) });
      }
    }
  }
  return out;
}

/** A few words around the amount, from the original text. */
function clip(doc: Doc, index: number, start: number, end: number) {
  const unit = doc.units[index];
  const norm = unit.n;
  let s = start; let words = 0;
  while (s > 0 && words < 5) { s -= 1; if (/\s/u.test(norm[s]) && !/\s/u.test(norm[s + 1] ?? "")) words += 1; if (BOUNDARY.test(norm[s])) { s += 1; break; } }
  let e = end; words = 0;
  while (e < norm.length && words < 5) { if (BOUNDARY.test(norm[e])) break; if (/\s/u.test(norm[e]) && !/\s/u.test(norm[e - 1] ?? "")) words += 1; e += 1; }
  const raw = doc.raw.slice(doc.map[unit.ns + s] ?? 0, doc.map[unit.ns + e] ?? doc.raw.length).trim();
  return raw.replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/gu, "").slice(0, 160);
}

export type { Evidence };
