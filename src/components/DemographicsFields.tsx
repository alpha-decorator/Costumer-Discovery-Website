"use client";

import { AREAS, EDUCATIONS, GENDERS, INCOMES, OCCUPATIONS, STATES, VEHICLES, type Demographics } from "@/lib/demographics";

type Props = {
  value: Demographics; onChange: (next: Demographics) => void;
  city: string; onCityChange: (city: string) => void;
  lang: string; disabled?: boolean;
};

/** The customer-profile inputs (age, gender, city, state, area, occupation, income, education, vehicle). Every one is optional. */
export function DemographicsFields({ value, onChange, city, onCityChange, lang, disabled }: Props) {
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  const set = <K extends keyof Demographics>(key: K, next: Demographics[K] | "") => onChange({ ...value, [key]: next === "" ? undefined : next });
  const choice = <K extends keyof Demographics>(key: K, label: string, list: readonly { value: string; en: string; hi: string }[]) =>
    <label><span>{label}</span><select value={(value[key] as string | undefined) ?? ""} onChange={(event) => set(key, event.target.value as Demographics[K])} disabled={disabled}>
      <option value="">{L("Not given", "नहीं बताया")}</option>
      {list.map((item) => <option key={item.value} value={item.value}>{lang === "hi" ? item.hi : item.en}</option>)}
    </select></label>;

  return <div className="upload-form-grid fn-profile-grid">
    <label><span>{L("Age", "उम्र")}</span><input type="number" inputMode="numeric" min={10} max={110} step={1} value={value.age ?? ""} placeholder={L("e.g. 32", "जैसे: 32")} disabled={disabled}
      onChange={(event) => { const n = event.target.value === "" ? undefined : Math.round(Number(event.target.value)); set("age", n !== undefined && Number.isFinite(n) ? n : undefined); }} /></label>
    {choice("gender", L("Gender", "लिंग"), GENDERS)}
    <label><span>{L("City", "शहर")}</span><input value={city} onChange={(event) => onCityChange(event.target.value)} placeholder={L("e.g. Jaipur", "जैसे: जयपुर")} maxLength={80} list="fn-cities" disabled={disabled} /></label>
    <label><span>{L("State / region", "राज्य / क्षेत्र")}</span><select value={value.state ?? ""} onChange={(event) => set("state", event.target.value)} disabled={disabled}>
      <option value="">{L("Not given", "नहीं बताया")}</option>
      {STATES.map((state) => <option key={state.name} value={state.name}>{lang === "hi" ? state.hi : state.name}</option>)}
    </select></label>
    {choice("area", L("Lives in", "रहते हैं"), AREAS)}
    {choice("occupation", L("Occupation", "पेशा"), OCCUPATIONS)}
    {choice("income", L("Monthly household income", "मासिक घरेलू आय"), INCOMES)}
    {choice("education", L("Education", "शिक्षा"), EDUCATIONS)}
    {choice("vehicle", L("Main way of travelling", "आने-जाने का मुख्य साधन"), VEHICLES)}
  </div>;
}
