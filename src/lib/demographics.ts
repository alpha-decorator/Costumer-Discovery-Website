/**
 * Customer profile (demographics) recorded with an interview: who the person is, kept apart from what they said.
 * Every field is optional. The lists below are the choices offered on the upload form, each with an English and Hindi label.
 */
import { findCity } from "./cities";

type Option<T extends string> = { value: T; en: string; hi: string };
const opts = <T extends string>(list: Option<T>[]) => list;

export const GENDERS = opts([
  { value: "female", en: "Female", hi: "महिला" },
  { value: "male", en: "Male", hi: "पुरुष" },
  { value: "other", en: "Other / prefer not to say", hi: "अन्य / नहीं बताना" },
] as const);

export const AREAS = opts([
  { value: "metro", en: "Metro city", hi: "महानगर" },
  { value: "city", en: "City", hi: "शहर" },
  { value: "town", en: "Small town", hi: "क़स्बा" },
  { value: "village", en: "Village", hi: "गाँव" },
] as const);

export const OCCUPATIONS = opts([
  { value: "student", en: "Student", hi: "छात्र" },
  { value: "salaried", en: "Salaried job", hi: "नौकरी" },
  { value: "business", en: "Business owner", hi: "व्यवसायी" },
  { value: "self-employed", en: "Self-employed / freelancer", hi: "स्व-रोज़गार" },
  { value: "driver", en: "Driver / delivery", hi: "ड्राइवर / डिलीवरी" },
  { value: "farmer", en: "Farmer", hi: "किसान" },
  { value: "homemaker", en: "Homemaker", hi: "गृहिणी" },
  { value: "retired", en: "Retired", hi: "सेवानिवृत्त" },
  { value: "other", en: "Other", hi: "अन्य" },
] as const);

export const INCOMES = opts([
  { value: "lt15k", en: "Under ₹15,000", hi: "₹15,000 से कम" },
  { value: "15-30k", en: "₹15,000–30,000", hi: "₹15,000–30,000" },
  { value: "30-60k", en: "₹30,000–60,000", hi: "₹30,000–60,000" },
  { value: "60k-1L", en: "₹60,000–1 lakh", hi: "₹60,000–1 लाख" },
  { value: "gt1L", en: "Over ₹1 lakh", hi: "₹1 लाख से ज़्यादा" },
] as const);

export const EDUCATIONS = opts([
  { value: "school", en: "School", hi: "स्कूल" },
  { value: "graduate", en: "Graduate", hi: "स्नातक" },
  { value: "postgraduate", en: "Postgraduate", hi: "स्नातकोत्तर" },
  { value: "other", en: "Other", hi: "अन्य" },
] as const);

export const VEHICLES = opts([
  { value: "two-wheeler", en: "Two-wheeler", hi: "दोपहिया" },
  { value: "car", en: "Car", hi: "कार" },
  { value: "auto-taxi", en: "Auto / cab", hi: "ऑटो / कैब" },
  { value: "public", en: "Bus / train / metro", hi: "बस / ट्रेन / मेट्रो" },
  { value: "commercial", en: "Truck / commercial", hi: "ट्रक / कमर्शियल" },
  { value: "none", en: "No vehicle", hi: "कोई वाहन नहीं" },
] as const);

/** States and union territories with a rough centre, used to place an interview on the map when no known city was given. */
export const STATES: Array<{ name: string; hi: string; lat: number; lon: number }> = [
  { name: "Andhra Pradesh", hi: "आंध्र प्रदेश", lat: 15.9, lon: 79.7 }, { name: "Arunachal Pradesh", hi: "अरुणाचल प्रदेश", lat: 28.2, lon: 94.7 },
  { name: "Assam", hi: "असम", lat: 26.2, lon: 92.9 }, { name: "Bihar", hi: "बिहार", lat: 25.6, lon: 85.6 },
  { name: "Chhattisgarh", hi: "छत्तीसगढ़", lat: 21.3, lon: 81.9 }, { name: "Goa", hi: "गोवा", lat: 15.4, lon: 74.0 },
  { name: "Gujarat", hi: "गुजरात", lat: 22.6, lon: 71.6 }, { name: "Haryana", hi: "हरियाणा", lat: 29.1, lon: 76.1 },
  { name: "Himachal Pradesh", hi: "हिमाचल प्रदेश", lat: 31.9, lon: 77.2 }, { name: "Jharkhand", hi: "झारखंड", lat: 23.6, lon: 85.3 },
  { name: "Karnataka", hi: "कर्नाटक", lat: 14.9, lon: 75.9 }, { name: "Kerala", hi: "केरल", lat: 10.4, lon: 76.4 },
  { name: "Madhya Pradesh", hi: "मध्य प्रदेश", lat: 23.5, lon: 78.2 }, { name: "Maharashtra", hi: "महाराष्ट्र", lat: 19.5, lon: 75.9 },
  { name: "Manipur", hi: "मणिपुर", lat: 24.7, lon: 93.9 }, { name: "Meghalaya", hi: "मेघालय", lat: 25.5, lon: 91.4 },
  { name: "Mizoram", hi: "मिज़ोरम", lat: 23.2, lon: 92.9 }, { name: "Nagaland", hi: "नागालैंड", lat: 26.1, lon: 94.5 },
  { name: "Odisha", hi: "ओडिशा", lat: 20.5, lon: 84.4 }, { name: "Punjab", hi: "पंजाब", lat: 30.9, lon: 75.4 },
  { name: "Rajasthan", hi: "राजस्थान", lat: 26.8, lon: 73.8 }, { name: "Sikkim", hi: "सिक्किम", lat: 27.5, lon: 88.5 },
  { name: "Tamil Nadu", hi: "तमिलनाडु", lat: 11.0, lon: 78.4 }, { name: "Telangana", hi: "तेलंगाना", lat: 17.9, lon: 79.0 },
  { name: "Tripura", hi: "त्रिपुरा", lat: 23.8, lon: 91.6 }, { name: "Uttar Pradesh", hi: "उत्तर प्रदेश", lat: 26.9, lon: 80.6 },
  { name: "Uttarakhand", hi: "उत्तराखंड", lat: 30.1, lon: 79.1 }, { name: "West Bengal", hi: "पश्चिम बंगाल", lat: 23.4, lon: 87.9 },
  { name: "Andaman and Nicobar Islands", hi: "अंडमान और निकोबार", lat: 11.7, lon: 92.7 }, { name: "Chandigarh", hi: "चंडीगढ़", lat: 30.73, lon: 76.78 },
  { name: "Dadra and Nagar Haveli and Daman and Diu", hi: "दादरा नगर हवेली और दमन दीव", lat: 20.4, lon: 72.9 }, { name: "Delhi", hi: "दिल्ली", lat: 28.61, lon: 77.21 },
  { name: "Jammu and Kashmir", hi: "जम्मू और कश्मीर", lat: 33.6, lon: 75.0 }, { name: "Ladakh", hi: "लद्दाख", lat: 34.3, lon: 77.4 },
  { name: "Lakshadweep", hi: "लक्षद्वीप", lat: 10.6, lon: 72.6 }, { name: "Puducherry", hi: "पुडुचेरी", lat: 11.94, lon: 79.81 },
];

/** The state each city in cities.ts belongs to, so a city alone is enough to count the state. */
const CITY_STATE: Record<string, string> = {
  Delhi: "Delhi", Mumbai: "Maharashtra", Bengaluru: "Karnataka", Hyderabad: "Telangana", Chennai: "Tamil Nadu", Kolkata: "West Bengal",
  Pune: "Maharashtra", Ahmedabad: "Gujarat", Jaipur: "Rajasthan", Lucknow: "Uttar Pradesh", Kanpur: "Uttar Pradesh", Nagpur: "Maharashtra",
  Indore: "Madhya Pradesh", Bhopal: "Madhya Pradesh", Patna: "Bihar", Surat: "Gujarat", Vadodara: "Gujarat", Rajkot: "Gujarat",
  Chandigarh: "Chandigarh", Ludhiana: "Punjab", Amritsar: "Punjab", Gurugram: "Haryana", Noida: "Uttar Pradesh", Ghaziabad: "Uttar Pradesh",
  Faridabad: "Haryana", Agra: "Uttar Pradesh", Varanasi: "Uttar Pradesh", Prayagraj: "Uttar Pradesh", Meerut: "Uttar Pradesh",
  Dehradun: "Uttarakhand", Shimla: "Himachal Pradesh", Srinagar: "Jammu and Kashmir", Jammu: "Jammu and Kashmir", Leh: "Ladakh",
  Jodhpur: "Rajasthan", Udaipur: "Rajasthan", Kota: "Rajasthan", Ajmer: "Rajasthan", Bikaner: "Rajasthan", Gwalior: "Madhya Pradesh",
  Jabalpur: "Madhya Pradesh", Raipur: "Chhattisgarh", Ranchi: "Jharkhand", Jamshedpur: "Jharkhand", Bhubaneswar: "Odisha", Cuttack: "Odisha",
  Guwahati: "Assam", Shillong: "Meghalaya", Imphal: "Manipur", Agartala: "Tripura", Siliguri: "West Bengal", Gangtok: "Sikkim",
  Visakhapatnam: "Andhra Pradesh", Vijayawada: "Andhra Pradesh", Warangal: "Telangana", Coimbatore: "Tamil Nadu", Madurai: "Tamil Nadu",
  Tiruchirappalli: "Tamil Nadu", Puducherry: "Puducherry", Kochi: "Kerala", Thiruvananthapuram: "Kerala", Kozhikode: "Kerala",
  Mysuru: "Karnataka", Mangaluru: "Karnataka", Hubballi: "Karnataka", Belagavi: "Karnataka", Goa: "Goa", Nashik: "Maharashtra",
  Aurangabad: "Maharashtra", Kolhapur: "Maharashtra", Solapur: "Maharashtra", Gorakhpur: "Uttar Pradesh", Bareilly: "Uttar Pradesh",
  Aligarh: "Uttar Pradesh", Mathura: "Uttar Pradesh", Haridwar: "Uttarakhand", Panipat: "Haryana", Rohtak: "Haryana", Hisar: "Haryana",
  "Port Blair": "Andaman and Nicobar Islands",
};

type Values<T extends readonly Option<string>[]> = T[number]["value"];
export type Demographics = {
  age?: number;
  gender?: Values<typeof GENDERS>;
  state?: string;
  area?: Values<typeof AREAS>;
  occupation?: Values<typeof OCCUPATIONS>;
  income?: Values<typeof INCOMES>;
  education?: Values<typeof EDUCATIONS>;
  vehicle?: Values<typeof VEHICLES>;
};

export const AGE_GROUPS = [
  { key: "18-24", min: 0, max: 24 }, { key: "25-34", min: 25, max: 34 }, { key: "35-44", min: 35, max: 44 },
  { key: "45-54", min: 45, max: 54 }, { key: "55+", min: 55, max: 200 },
] as const;
export const ageGroup = (age?: number) => age === undefined ? undefined : AGE_GROUPS.find((group) => age >= group.min && age <= group.max)?.key;

/** The label of a stored value in the chosen language (the value itself if it is unknown). */
export function optionLabel(list: readonly Option<string>[], value: string | undefined, lang: string) {
  const found = list.find((item) => item.value === value);
  return found ? (lang === "hi" ? found.hi : found.en) : value ?? "";
}

export const stateLabel = (name: string, lang: string) => lang === "hi" ? STATES.find((state) => state.name === name)?.hi ?? name : name;

/** The state an interview counts towards: the one chosen, or else the state of its city. */
export function stateOf(demographics: Demographics | undefined, city: string | undefined) {
  if (demographics?.state) return demographics.state;
  const found = findCity(city);
  return found ? CITY_STATE[found.name] : undefined;
}

/** Drops empty fields, so a profile with nothing filled in is stored as nothing. */
export function cleanDemographics(value: Demographics | undefined): Demographics | undefined {
  if (!value) return undefined;
  const out: Demographics = {};
  for (const [key, field] of Object.entries(value) as Array<[keyof Demographics, unknown]>) {
    if (field === undefined || field === null || field === "" || (typeof field === "number" && !Number.isFinite(field))) continue;
    (out as Record<string, unknown>)[key] = field;
  }
  return Object.keys(out).length ? out : undefined;
}

const inList = (list: readonly Option<string>[], value: unknown) => value === undefined || list.some((item) => item.value === value);

/** Says what is wrong with a submitted profile, or null when it is fine (or absent). */
export function demographicsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "demographics is not an object";
  const record = value as Record<string, unknown>;
  const allowed = new Set(["age", "gender", "state", "area", "occupation", "income", "education", "vehicle"]);
  const extra = Object.keys(record).find((key) => !allowed.has(key));
  if (extra) return `demographics.${extra} is not a known field`;
  if (record.age !== undefined && !(typeof record.age === "number" && Number.isInteger(record.age) && record.age >= 10 && record.age <= 110)) return "demographics.age must be a whole number from 10 to 110";
  if (record.state !== undefined && !STATES.some((state) => state.name === record.state)) return "demographics.state is not an Indian state or union territory";
  const lists: Array<[string, readonly Option<string>[]]> = [["gender", GENDERS], ["area", AREAS], ["occupation", OCCUPATIONS], ["income", INCOMES], ["education", EDUCATIONS], ["vehicle", VEHICLES]];
  const bad = lists.find(([key, list]) => !inList(list, record[key]));
  return bad ? `demographics.${bad[0]} is not one of the choices` : null;
}

export function parseDemographics(text: unknown): Demographics | undefined {
  if (typeof text !== "string" || !text) return undefined;
  try { const parsed: unknown = JSON.parse(text); return demographicsProblem(parsed) ? undefined : cleanDemographics(parsed as Demographics); } catch { return undefined; }
}
