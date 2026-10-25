"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { format, type DictKey } from "@/lib/i18n";
import type { Interview } from "@/lib/interviews";
import { MENTION_TYPES, sentimentTone, type MentionType } from "@/lib/trata";

const canon = (name: string) => name.toLowerCase().replace(/[\s.,;:!?"'()\-]+/g, "");
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;

/** Across the selected customers: which features come up most and how people feel about them, and every specific thing customers said. */
export function MentionsBoard({ customers, onOpen }: { customers: Interview[]; onOpen: (customer: Interview) => void }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<MentionType | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const analysed = useMemo(() => customers.filter((customer) => customer.analysis), [customers]);

  const features = useMemo(() => {
    const table = new Map<string, { name: string; customers: Set<string>; total: number; count: number; mustHave: number }>();
    for (const customer of analysed) for (const feature of customer.analysis!.features) {
      const key = canon(feature.name);
      const row = table.get(key) ?? { name: feature.name, customers: new Set<string>(), total: 0, count: 0, mustHave: 0 };
      row.customers.add(customer.id); row.total += feature.score; row.count += 1; row.mustHave += feature.importance === "must_have" ? 1 : 0;
      table.set(key, row);
    }
    return [...table.values()].map((row) => ({ ...row, people: row.customers.size, average: row.total / row.count }))
      .sort((a, b) => b.people - a.people || Math.abs(b.average) - Math.abs(a.average)).slice(0, 8);
  }, [analysed]);

  // Across customers only mentions backed by a quote that really is in the transcript are shown; the rest stay in each customer's own report.
  const everyMention = useMemo(() => analysed.flatMap((customer) => customer.analysis!.mentions.map((mention) => ({ customer, mention }))), [analysed]);
  const mentions = useMemo(() => everyMention.filter(({ mention }) => mention.evidence?.verified), [everyMention]);
  const hidden = everyMention.length - mentions.length;
  const present = MENTION_TYPES.filter((type) => mentions.some(({ mention }) => mention.type === type));
  const filtered = mentions.filter(({ mention }) => filter === "all" || mention.type === filter);
  const shown = showAll ? filtered : filtered.slice(0, 12);

  return (
    <section className="tr-board" aria-labelledby="tr-board-title">
      <h3 id="tr-board-title">{t.trBoardTitle}</h3>
      <p className="tr-fine">{t.trBoardSub}</p>
      {analysed.length === 0 ? <p className="tr-empty">{t.trBoardEmpty}</p> : <>
        {features.length > 0 && <>
          <h4>{t.trBoardFeatures}</h4>
          <ul className="tr-features tr-board-features">
            {features.map((row) => {
              const width = Math.abs(row.average) * 50;
              const featureTone = sentimentTone(row.average);
              return <li key={row.name}><div className="tr-feature-row static">
                <span className="tr-feature-name">{row.name}{row.mustHave > 0 && <em>{format(t.trBoardMust, { n: row.mustHave })}</em>}</span>
                <span className="tr-bar" aria-hidden="true"><span className="tr-bar-mid" /><i className={`tone-${featureTone}`} style={{ width: `${width}%`, left: row.average >= 0 ? "50%" : `${50 - width}%` }} /></span>
                <span className={`tr-stance tone-${featureTone}`}>{row.people === 1 ? t.trBoardPerson : format(t.trBoardPeople, { n: row.people })} <b>{signed(row.average)}</b></span>
              </div></li>;
            })}
          </ul>
        </>}
        {hidden > 0 && <p className="tr-fine" role="note">{format(t.trBoardHidden, { n: hidden })}</p>}
        {mentions.length > 0 && <>
          <div className="tr-filters" role="group" aria-label={t.trBoardTitle}>
            <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>{t.trMentionsAll} <b>{mentions.length}</b></button>
            {present.map((type) => <button key={type} type="button" className={filter === type ? "on" : ""} onClick={() => setFilter(type)}>{t[`mention_${type}` as DictKey]} <b>{mentions.filter(({ mention }) => mention.type === type).length}</b></button>)}
          </div>
          <ul className="tr-mentions">
            {shown.map(({ customer, mention }, index) => (
              <li key={`${customer.id}-${index}`} className={`mention-${mention.type}`}>
                <span className="tr-type">{t[`mention_${mention.type}` as DictKey]}</span>
                <p>{mention.text}</p>
                {mention.evidence && <blockquote lang={customer.language === "hi" ? "hi" : undefined}>“{mention.evidence.text}”</blockquote>}
                <button type="button" className="tr-jump" onClick={() => onOpen(customer)}>{format(t.trBoardFrom, { name: customer.name })}</button>
              </li>
            ))}
          </ul>
          {filtered.length > 12 && <button type="button" className="button-secondary" onClick={() => setShowAll((value) => !value)}>{showAll ? t.trBoardLess : format(t.trBoardMore, { n: filtered.length - 12 })}</button>}
        </>}
      </>}
    </section>
  );
}
