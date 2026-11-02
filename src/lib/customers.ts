import type { Interview } from "@/lib/interviews";

export type Customer = Interview;
export type Tier = Interview["tier"];
export type TierFilter = "All" | Tier;
export type Topic = "UX" | "Pricing" | "Features";

export const TOPICS: Topic[] = ["UX", "Pricing", "Features"];
export const TIERS: Tier[] = ["Expert", "Public", "Newbie"];

/** Example interviews shown until the person saves their own. Deleting one only hides it on this computer. */
export const SAMPLE_CUSTOMERS: Customer[] = [
  { id: "CD-1042", name: "Aarav Mehta", initials: "AM", company: "Northstar Labs", city: "Bengaluru", demographics: { age: 34, gender: "male", state: "Karnataka", area: "metro", occupation: "salaried", income: "gt1L", education: "postgraduate", vehicle: "car" }, tier: "Expert", date: "Oct 22, 2026", sentiment: 0.86, transcript: "The reporting workflow is thoughtful. I would love a faster way to compare cohorts.", language: "en", topics: { UX: 0.72, Pricing: 0.52, Features: 0.91 }, keyPoints: ["Reporting workflow feels thoughtful and clear.", "Wants a faster way to compare customer cohorts."] },
  { id: "CD-1041", name: "Priya Sharma", initials: "PS", company: "Mitti Studio", city: "Jaipur", demographics: { age: 27, gender: "female", state: "Rajasthan", area: "city", occupation: "business", income: "30-60k", education: "graduate", vehicle: "two-wheeler" }, tier: "Public", date: "Oct 21, 2026", sentiment: 0.64, transcript: "मुझे डैशबोर्ड समझने में आसान लगा, लेकिन शुरुआत में कुछ मार्गदर्शन मददगार होगा।", language: "hi", topics: { UX: 0.79, Pricing: 0.24, Features: 0.49 }, keyPoints: ["डैशबोर्ड समझने में आसान लगा।", "शुरुआत में मार्गदर्शन और उदाहरण मददगार होंगे।"] },
  { id: "CD-1040", name: "Kabir Rao", initials: "KR", company: "Monsoon Works", city: "Mumbai", demographics: { age: 41, gender: "male", state: "Maharashtra", area: "metro", occupation: "business", income: "60k-1L", education: "graduate", vehicle: "car" }, tier: "Expert", date: "Oct 20, 2026", sentiment: 0.77, transcript: "Clear value for our team. The setup is simple and the insights feel actionable.", language: "en", topics: { UX: 0.82, Pricing: 0.68, Features: 0.78 }, keyPoints: ["Sees clear value for the team.", "Setup is simple; insights feel actionable."] },
  { id: "CD-1039", name: "Ananya Iyer", initials: "AI", company: "Goodkind Health", city: "Chennai", demographics: { age: 30, gender: "female", state: "Tamil Nadu", area: "metro", occupation: "salaried", income: "30-60k", education: "postgraduate", vehicle: "public" }, tier: "Public", date: "Oct 18, 2026", sentiment: 0.41, transcript: "The idea is promising, though I am not sure how the pricing scales for a small team.", language: "en", topics: { UX: 0.56, Pricing: -0.31, Features: 0.48 }, keyPoints: ["Finds the product idea promising.", "Unclear how pricing scales for small teams."] },
  { id: "CD-1038", name: "Rohan Verma", initials: "RV", company: "Independent", city: "Lucknow", demographics: { age: 22, gender: "male", state: "Uttar Pradesh", area: "city", occupation: "student", income: "15-30k", education: "school", vehicle: "two-wheeler" }, tier: "Newbie", date: "Oct 17, 2026", sentiment: 0.28, transcript: "पहली बार इस्तेमाल किया। कुछ बटन और उदाहरणों के साथ समझना आसान होगा।", language: "hi", topics: { UX: 0.12, Pricing: 0.3, Features: 0.38 }, keyPoints: ["पहली बार उपयोग करने पर कुछ बटन समझ नहीं आए।", "उदाहरणों से शुरुआत आसान हो सकती है।"] },
];

export function tierWeight(tier: Tier) { return tier === "Expert" ? 1 : tier === "Public" ? 0.8 : 0.5; }
export function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
export function weightedMean(items: Customer[], getValue: (customer: Customer) => number) {
  const totalWeight = items.reduce((sum, customer) => sum + tierWeight(customer.tier), 0);
  return totalWeight ? items.reduce((sum, customer) => sum + tierWeight(customer.tier) * getValue(customer), 0) / totalWeight : 0;
}
export function initialsColor(name: string) { return name.charCodeAt(0) % 4; }
export function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }
/** Saved dates are read back as text; unreadable ones sort to the start instead of breaking the timeline. */
export function dateValue(date: string) { const time = Date.parse(date); return Number.isNaN(time) ? 0 : time; }
export function verdictOf(delta: number): "alignment" | "rejection" | "consensus" {
  return delta > 0.15 ? "alignment" : delta < -0.15 ? "rejection" : "consensus";
}
/** The colour of a tier is fixed (Expert blue, Public orange, Newbie aqua) so it never changes with the filter. */
export function tierColor(tier: Tier) { return tier === "Expert" ? "var(--s1)" : tier === "Public" ? "var(--s2)" : "var(--s3)"; }

/** The numbers the insight pages show: simple and tier-weighted sentiment, their gap, and topic scores. */
export function summarize(items: Customer[]) {
  const simple = mean(items.map((customer) => customer.sentiment));
  const weighted = weightedMean(items, (customer) => customer.sentiment);
  const topics = TOPICS.map((topic) => {
    const talked = items.filter((customer) => customer.analysis?.topics[topic].discussed !== false);
    return { name: topic, simple: mean(talked.map((customer) => customer.topics[topic])), weighted: weightedMean(talked, (customer) => customer.topics[topic]) };
  });
  return { count: items.length, simple, weighted, delta: weighted - simple, verdict: verdictOf(weighted - simple), topics };
}
