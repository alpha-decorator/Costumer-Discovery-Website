/**
 * Who is speaking? A phone call usually arrives as one block of text with no speaker names, so this guesses, unit by unit,
 * whether a stretch is the interviewer asking a QUESTION, the interviewer explaining the idea (the PITCH), or the customer
 * talking. Opinions are only taken from the customer's side: the pitch is full of words like "आसान" and "automatic" that
 * are not anyone's opinion, and a question like "कितना यूसफुल लगता है?" is not praise.
 *
 * Signals, strongest first: speaker labels written in the transcript ("Interviewer:", "ग्राहक:"), timestamp blocks (each block
 * is one speaker), question wording, pitch wording, and "I / my / मुझे" which only the person giving an opinion says.
 */
import { phrase, WORD, WORD_END } from "@/lib/call-sentiment";
import { once, rx, type Unit } from "./text";

export type Kind = "Q" | "P" | "C";
export type Classified = Unit & { kind: Kind; who: "I" | "C" };
export type SpeakerMode = "labels" | "blocks" | "guessed";

const W = WORD;
const E = WORD_END;
const re = (source: string) => rx(`${W}(?:${source})${E}`, "u");

// ---- questions ---------------------------------------------------------------------------------------------------
const QUESTION_WORD = "क्या|कितना|कितनी|कितने|कैसे|कैसा|कैसी|क्यों|क्यूं|क्यू|कहां|कहाँ|कब|कौन|किसने|किसको|किसे|किस|किन|कौनसा|कौन सा|कौनसी|कितनी बार|बताइए|बताओ|बताइये|बताईये|बताना|बताएं|बताएँ|बताइएगा|do you|did you|does it|does this|would you|can you|could you|will you|are you|is it|is there|how|what|why|when|where|which|who|tell me|please tell|kya|kitna|kitni|kaise|kyun|kyu|kab|kaun|batao|bataiye|bataiyega";
const QUESTION_HEAD = new RegExp(`^(?:(?:और|तो|अच्छा|ठीक है|फिर|so|and|then|okay|ok|well)\\s+)?(?:${QUESTION_WORD})(?![\\p{L}\\p{M}\\p{N}])`, "u");
export const QUESTION_ANYWHERE = re(QUESTION_WORD);
export const YOU = re("आप|आपको|आपने|आपके|आपकी|आपका|तुम|तुझे|तुझको|तुमने|तूने|तेरे|तेरी|तेरा|तुम्हें|तुम्हारे|तुम्हारा|you|your|आप को");
const ASK_VERB = re("बताइए|बताओ|बताइये|बताईये|बताना|बताएं|बताएँ|बताइएगा|tell me|please tell|batao|bataiye|समझाइए|समझाओ|explain|describe|share with me|और बताइए");
const ENDS_WITH_ASK = rx(`(?:${[
  "क्या", "या नहीं", "या नही", "है न", "है ना", "हैं न", "हैं ना", "ठीक है न", "सही है न", "लगता है क्या", "होगा क्या", "रहेगा क्या",
  "right", "isn't it", "no", "or not", "okay", "ok",
].join("|")})\\s*$`, "u");

export function isQuestion(unit: Unit) {
  if (unit.asked) return true;
  const text = unit.n;
  if (QUESTION_HEAD.test(text)) return true;
  if (ASK_VERB.test(text)) return true;
  if (ENDS_WITH_ASK.test(text) && unit.words <= 18 && YOU.test(text)) return true;
  // "आपको ... कैसा लगा", "आप ... कितना ... करते हो": a question word AND a "you" in the same short stretch.
  return unit.words <= 40 && YOU.test(text) && QUESTION_ANYWHERE.test(text);
}

// ---- the interviewer explaining the idea -------------------------------------------------------------------------
const TRATA_NAME = "तराता|ट्राटा|ट्रेटा|तरता|त्राता|ट्राइटा|तराटा|trataboo|trata|ट्रैटा|तारता|त्रेटा|त्रता";
const PITCH_SIGNALS: Array<{ re: RegExp; weight: number }> = [
  { re: rx(`${W}(?:हम|हमारा|हमारी|हमारे|हमने|हमें|our|we)${E}[^.?!।\\n]{0,50}${W}(?:बना[\\p{L}\\p{M}]*|डिजाइन[\\p{L}\\p{M}]*|डिज़ाइन[\\p{L}\\p{M}]*|लॉन्च[\\p{L}\\p{M}]*|लाउंच[\\p{L}\\p{M}]*|कर रहे|कर रही|करेंगे|सोच रहे|build[\\p{L}\\p{M}]*|design[\\p{L}\\p{M}]*|launch[\\p{L}\\p{M}]*|working on|developing|creating|आइडिया|आईडिया|idea|सोल्यूशन|सॉल्यूशन|solution|प्रोडक्ट|product|startup|स्टार्टअप|ला रहे|लाएंगे|लायेंगे)`, "u"), weight: 1.2 },
  { re: re(`${TRATA_NAME}`), weight: 0.6 },
  { re: rx(`${W}(?:ये|यह|इसमें|इसके|इसका|it|this)\\s+(?:क्या\\s+)?(?:करता है|करेगा|करेगी|करते हैं|करेंगे|कर देगा|कर देगी|भेज देगा|देगा|देगी|does|will)${E}(?!\\s*(?:कैसे|how))`, "u"), weight: 1 },
  { re: rx(`${W}(?:ऑटोमेटिक[\\p{L}\\p{M}]*|आटोमेटिक[\\p{L}\\p{M}]*|ओटोमेटिक[\\p{L}\\p{M}]*|ऑटोमैटिक[\\p{L}\\p{M}]*|आटोमैटिक[\\p{L}\\p{M}]*|automatic[\\p{L}\\p{M}]*|auto)${E}[^.?!।\\n]{0,50}${W}(?:डिटेक्ट[\\p{L}\\p{M}]*|detect[\\p{L}\\p{M}]*|कॉल|call|अलर्ट|alert|कॉन्टैक्ट|contact|कांटैक्ट|भेज[\\p{L}\\p{M}]*|send|इन्फॉर्म|inform|बुला)`, "u"), weight: 1 },
  { re: rx(`${W}(?:डिटेक्ट|detect)${E}[^.?!।\\n]{0,40}${W}(?:करेगा|कर लेगा|कर देगा|करके|करने के बाद|करेंगे|will)`, "u"), weight: 1 },
  { re: rx(`${W}(?:एम्बुलेंस|एंबुलेंस|ambulance|पुलिस|police|कैब ड्राइवर[\\p{L}\\p{M}]*|कैप ड्राइवर[\\p{L}\\p{M}]*|फैमिली|family|परिवार|हॉस्पिटल|hospital|लाइव लोकेशन|लाइफ लोकेशन|live location)${E}[^.?!।\\n]{0,70}${W}(?:जाएगा|जाएगी|जायेगा|जाएंगे|करेगा|करेगी|कर देगा|देगा|देगी|बुलाएंगे|दिखेगा|पहुंचेगा|will)${E}`, "u"), weight: 1 },
  { re: rx(`${W}(?:कस्टमर डिस्कवरी|customer discovery|कुछ (?:कश्चन|क्वेश्चन|कोश्चन|सवाल|question)[\\p{L}\\p{M}]*|questions? पूछ|just like आपको|answers देने)`, "u"), weight: 2 },
  { re: rx(`${W}(?:चार्ज|फीस|fee|कीमत|price|कॉस्ट|cost|सब्सक्रिप्शन|subscription)${E}[^.?!।\\n]{0,30}${W}(?:लेंगे|लगाएंगे|रखेंगे|रखा है|होगी|होगा|will charge)`, "u"), weight: 0.7 },
  { re: rx(`${W}(?:सेंसर[\\p{L}\\p{M}]*|sensor[\\p{L}\\p{M}]*)${E}[^.?!।\\n]{0,40}${W}(?:लगाएंगे|लगा देंगे|लगेंगे|लाएंगे|फिट|install[\\p{L}\\p{M}]*|integrate[\\p{L}\\p{M}]*)`, "u"), weight: 1 },
  { re: rx(`^(?:हम|हमारा|हमारी|हमें|हमने|हमारे)${E}`, "u"), weight: 0.5 },
  { re: rx(`${W}(?:देगा|देगी|करेगा|करेगी|कर देगा|कर देगी|कर लेगा|बता देगा|भेज देगा|मारेगा|जाएगा|जाएगी|जायेगा|जाएंगे|होगा|होगी|will)${E}`, "u"), weight: 0.45 },
  { re: rx(`${W}(?:आईआईटी|iit|इंक्यूबे[\\p{L}\\p{M}]*|incubat[\\p{L}\\p{M}]*|स्टार्ट ?अप|startup)${E}`, "u"), weight: 0.8 },
];

/** The first-person / opinion words only the person answering uses. */
const CUSTOMER_MARK = once(phrase("मुझे|मेरे|मेरी|मेरा|मैं|मैंने|मुझको|मेरे को|मुझसे|i think|i feel|i guess|i believe|i don't|i do not|i would|i will|i am|i'm|i have|my|me|myself|for me|personally|in my opinion|लगता है|लगा|लगी|लग रहा|मेरे हिसाब|मेरे ख्याल|mujhe|mera|meri|mere|main"));
const REPLY_START = rx(`^(?:हां|हाँ|हा|जी|जी हां|जी हाँ|जी बिल्कुल|बिल्कुल|ज़रूर|जरूर|नहीं|नही|ना|ओके|ठीक है|अच्छा|सही|yes|yeah|yep|no|nope|sure|okay|ok|right|of course|absolutely|haan|nahi|nahin|accha|achha|theek hai)${E}`, "u");

export function pitchScore(unit: Unit) {
  let score = 0;
  for (const signal of PITCH_SIGNALS) if (signal.re.test(unit.n)) score += signal.weight;
  return score;
}

export const hasCustomerMark = (unit: Unit) => CUSTOMER_MARK.test(unit.n);
export const startsWithReply = (unit: Unit) => REPLY_START.test(unit.n);

// ---- labels written in the transcript ----------------------------------------------------------------------------
const INTERVIEWER_LABEL = /^(?:interviewer|इंटरव्यूअर|इंटरव्यूवर|इंटरव्यू लेने वाला|question|प्रश्न|सवाल|host|team|trata team|q|i)$/u;
const CUSTOMER_LABEL = /^(?:customer|ग्राहक|कस्टमर|respondent|participant|प्रतिभागी|answer|उत्तर|जवाब|guest|interviewee|a|c)$/u;

export function classify(units: Unit[]): { units: Classified[]; mode: SpeakerMode } {
  const raw = units.map((unit) => ({ q: isQuestion(unit), p: pitchScore(unit), cm: hasCustomerMark(unit) }));
  const isPitch = (index: number) => raw[index].p >= 2 || (raw[index].p >= 1 && !raw[index].cm);

  // 1. Speaker labels. A unit without a label continues the speaker of the one before it.
  const labelled = units.some((unit) => unit.label);
  const speakerOfLabel = new Map<string, "I" | "C">();
  if (labelled) {
    const stats = new Map<string, { total: number; asking: number }>();
    let current: string | undefined;
    units.forEach((unit, index) => {
      if (unit.label) current = unit.label;
      if (!current) return;
      const row = stats.get(current) ?? { total: 0, asking: 0 };
      row.total += 1;
      if (raw[index].q || isPitch(index)) row.asking += 1;
      stats.set(current, row);
    });
    const unknown: string[] = [];
    for (const label of stats.keys()) {
      if (INTERVIEWER_LABEL.test(label)) speakerOfLabel.set(label, "I");
      else if (CUSTOMER_LABEL.test(label)) speakerOfLabel.set(label, "C");
      else unknown.push(label);
    }
    // "Speaker 1 / Speaker 2": the one who asks and explains most is the interviewer.
    if (unknown.length) {
      const ranked = unknown.map((label) => ({ label, share: stats.get(label)!.asking / Math.max(1, stats.get(label)!.total) })).sort((a, b) => b.share - a.share);
      const assigned = new Set(speakerOfLabel.values());
      ranked.forEach((item, rank) => {
        if (rank === 0 && !assigned.has("I") && item.share >= 0.3) speakerOfLabel.set(item.label, "I");
        else speakerOfLabel.set(item.label, "C");
      });
    }
  }

  // 2. Sequential guess for everything else.
  let mode: "none" | "pitch" | "answer" = "none";
  let block = -1;
  let currentLabel: string | undefined;
  const out: Classified[] = units.map((unit, index) => {
    if (unit.block !== block) { block = unit.block; mode = "none"; }
    if (unit.label) currentLabel = unit.label;
    const fromLabel = currentLabel ? speakerOfLabel.get(currentLabel) : undefined;
    if (fromLabel) {
      if (fromLabel === "I") return { ...unit, who: "I" as const, kind: raw[index].q ? ("Q" as const) : ("P" as const) };
      return { ...unit, who: "C" as const, kind: "C" as const };
    }
    if (unit.asked) { mode = "answer"; return { ...unit, who: "I" as const, kind: "Q" as const }; }
    if (isPitch(index)) { mode = "pitch"; return { ...unit, who: "I" as const, kind: "P" as const }; }
    if (raw[index].q) { mode = "answer"; return { ...unit, who: "I" as const, kind: "Q" as const }; }
    if (mode === "pitch" && !raw[index].cm && !startsWithReply(unit)) return { ...unit, who: "I" as const, kind: "P" as const };
    mode = "answer";
    return { ...unit, who: "C" as const, kind: "C" as const };
  });

  // 3. Timestamp blocks: each block is one speaker, so give the whole block to whoever the majority of its units sound like.
  let speakerMode: SpeakerMode = labelled ? "labels" : "guessed";
  const blocks = new Set(out.map((unit) => unit.block));
  if (!labelled && blocks.size >= 4) {
    speakerMode = "blocks";
    for (const id of blocks) {
      const members = out.filter((unit) => unit.block === id);
      const asking = members.filter((unit) => unit.who === "I").length;
      const who: "I" | "C" = asking / members.length >= 0.5 ? "I" : "C";
      for (const unit of members) {
        unit.who = who;
        unit.kind = who === "C" ? "C" : unit.kind === "C" ? "P" : unit.kind;
      }
    }
  }

  // 4. Nothing sounded like the customer (everything was a question or pitch): the text is probably the customer's own notes.
  if (!out.some((unit) => unit.kind === "C")) {
    for (const unit of out) if (unit.kind !== "Q") { unit.kind = "C"; unit.who = "C"; }
  }
  return { units: out, mode: speakerMode };
}
