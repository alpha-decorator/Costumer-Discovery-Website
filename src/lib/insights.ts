/**
 * What a call says about the customer beyond the score: would they use and pay, the prices they named, what they asked
 * for, what worries them and what they use today. Shared by the customer panel, the full report and the PDF, so all
 * three show the same thing. Pure TypeScript, no React.
 */
import type { Customer } from "@/lib/customers";
import type { Intent, Mention, MentionType, PricePeriod, PricePoint, PriceStance, TrataAnalysis } from "@/lib/trata";

type Lang = "en" | "hi";
const pick = (lang: Lang, en: string, hi: string) => lang === "hi" ? hi : en;

export function rupees(amount: number) { return `₹${amount.toLocaleString("en-IN")}`; }

export function periodLabel(period: PricePeriod, lang: Lang) {
  return period === "month" ? pick(lang, "per month", "प्रति माह")
    : period === "year" ? pick(lang, "per year", "प्रति वर्ष")
    : period === "one_time" ? pick(lang, "one-time", "एक बार")
    : pick(lang, "period not said", "अवधि नहीं बताई");
}

export function priceStanceLabel(stance: PriceStance, lang: Lang) {
  return stance === "accepts" ? pick(lang, "Willing to pay", "देने को तैयार")
    : stance === "too_high" ? pick(lang, "Too expensive", "बहुत महंगा")
    : stance === "suggests" ? pick(lang, "Suggested price", "सुझाई गई कीमत")
    : pick(lang, "Mentioned", "ज़िक्र किया");
}

/** "Up to ₹2,000 per year" / "More than ₹3,000 per year" style headline for one price. */
export function priceHeadline(price: PricePoint, lang: Lang) {
  const amount = rupees(price.amount);
  const lead = price.limit === "max" ? (price.stance === "too_high" ? pick(lang, `Above ${amount}`, `${amount} से ज़्यादा`) : pick(lang, `Up to ${amount}`, `${amount} तक`)) : amount;
  return price.period === "unspecified" ? lead : `${lead} ${periodLabel(price.period, lang)}`;
}

export function priceTone(stance: PriceStance) { return stance === "accepts" || stance === "suggests" ? "pos" : stance === "too_high" ? "neg" : "neu"; }

/** The mention types, gathered under the headings a reader looks for. */
export const INSIGHT_GROUPS: Array<{ key: "asks" | "worries" | "uses" | "promises" | "pricing"; types: MentionType[] }> = [
  { key: "asks", types: ["feature_request", "suggestion"] },
  { key: "worries", types: ["objection", "privacy_concern", "pain_point"] },
  { key: "uses", types: ["use_case"] },
  { key: "promises", types: ["promise"] },
  { key: "pricing", types: ["pricing"] },
];

export function insightGroupTitle(key: (typeof INSIGHT_GROUPS)[number]["key"], lang: Lang) {
  return key === "asks" ? pick(lang, "Suggestions & feature requests", "सुझाव और फ़ीचर की माँग")
    : key === "worries" ? pick(lang, "Concerns & objections", "चिंताएँ और आपत्तियाँ")
    : key === "uses" ? pick(lang, "How they would use it", "वे इसका इस्तेमाल कैसे करेंगे")
    : key === "promises" ? pick(lang, "Offers of help", "मदद की पेशकश")
    : pick(lang, "What they said about price", "कीमत पर उन्होंने क्या कहा");
}

export type CustomerInsights = {
  wouldUse: Intent;
  wouldPay: Intent;
  prices: PricePoint[];
  groups: Array<{ key: (typeof INSIGHT_GROUPS)[number]["key"]; items: Mention[] }>;
  alternatives: string[];
  empty: boolean;
};

export function insightsOf(analysis: TrataAnalysis | null | undefined): CustomerInsights | null {
  if (!analysis) return null;
  const prices = analysis.prices ?? [];
  const groups = INSIGHT_GROUPS.map(({ key, types }) => ({ key, items: analysis.mentions.filter((mention) => types.includes(mention.type)) })).filter((group) => group.items.length);
  const alternatives = analysis.alternatives ?? [];
  const empty = !prices.length && !groups.length && !alternatives.length && analysis.wouldUse === "unclear" && analysis.wouldPay === "unclear";
  return { wouldUse: analysis.wouldUse, wouldPay: analysis.wouldPay, prices, groups, alternatives, empty };
}

/** A short line for a mention, without the quote marks. */
export function mentionText(mention: Mention) { return (mention.evidence?.text ?? mention.text).trim(); }

// ---------------------------------------------------------------- the group view

export type PriceRange = { period: PricePeriod; accepted: number[]; tooHigh: number[]; customers: number };
export type GroupInsights = {
  analysed: number;
  wouldUse: Record<Intent, number>;
  wouldPay: Record<Intent, number>;
  ranges: PriceRange[];
  asks: Array<{ who: string; text: string }>;
  worries: Array<{ who: string; text: string }>;
  promises: Array<{ who: string; text: string }>;
  alternatives: Array<{ name: string; count: number }>;
};

const zero = (): Record<Intent, number> => ({ yes: 0, maybe: 0, no: 0, unclear: 0 });

export function groupInsightsOf(customers: Customer[]): GroupInsights {
  const out: GroupInsights = { analysed: 0, wouldUse: zero(), wouldPay: zero(), ranges: [], asks: [], worries: [], promises: [], alternatives: [] };
  const ranges = new Map<PricePeriod, PriceRange & { seen: Set<string> }>();
  const alternatives = new Map<string, number>();
  for (const customer of customers) {
    const analysis = customer.analysis;
    if (!analysis) continue;
    out.analysed += 1;
    out.wouldUse[analysis.wouldUse] += 1;
    out.wouldPay[analysis.wouldPay] += 1;
    for (const price of analysis.prices ?? []) {
      if (price.stance === "mentioned") continue;
      const range = ranges.get(price.period) ?? { period: price.period, accepted: [], tooHigh: [], customers: 0, seen: new Set<string>() };
      (price.stance === "too_high" ? range.tooHigh : range.accepted).push(price.amount);
      if (!range.seen.has(customer.id)) { range.seen.add(customer.id); range.customers += 1; }
      ranges.set(price.period, range);
    }
    for (const mention of analysis.mentions) {
      const row = { who: customer.name, text: mentionText(mention) };
      if (mention.type === "feature_request" || mention.type === "suggestion") out.asks.push(row);
      else if (mention.type === "objection" || mention.type === "privacy_concern" || mention.type === "pain_point") out.worries.push(row);
      else if (mention.type === "promise") out.promises.push(row);
    }
    for (const name of new Set(analysis.alternatives ?? [])) alternatives.set(name, (alternatives.get(name) ?? 0) + 1);
  }
  const order: PricePeriod[] = ["one_time", "month", "year", "unspecified"];
  out.ranges = order.flatMap((period) => { const range = ranges.get(period); if (!range) return []; const { seen: _seen, ...rest } = range; return [rest]; });
  out.alternatives = Array.from(alternatives, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return out;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** "₹99 – ₹500 (typical ₹199)" for the prices customers accepted in one period. */
export function rangeText(values: number[], lang: Lang) {
  if (!values.length) return "—";
  const low = Math.min(...values), high = Math.max(...values);
  if (low === high) return rupees(low);
  return `${rupees(low)} – ${rupees(high)} (${pick(lang, "typical", "आम तौर पर")} ${rupees(median(values))})`;
}
