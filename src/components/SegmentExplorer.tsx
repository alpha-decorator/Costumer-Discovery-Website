"use client";

import { useMemo } from "react";
import { MentionsBoard } from "@/components/MentionsBoard";
import { useI18n } from "@/components/I18nProvider";
import { format, type DictKey } from "@/lib/i18n";
import type { Interview } from "@/lib/interviews";
import { ACCIDENTS, INTENTS, ROLES, TRANSPORT, sentimentTone, type Intent } from "@/lib/trata";

type Tier = Interview["tier"];
export type Group = "All" | Tier;

const GROUPS: Group[] = ["Newbie", "Public", "Expert", "All"];
const WEIGHT: Record<Tier, number> = { Newbie: 0.5, Public: 0.8, Expert: 1 };
const BUCKETS = ["strong_negative", "negative", "neutral", "positive", "strong_positive"] as const;
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
const canon = (name: string) => name.toLowerCase().replace(/[\s.,;:!?"'()\-]+/g, "");

function bucketOf(score: number): (typeof BUCKETS)[number] {
  return score <= -0.6 ? "strong_negative" : score < -0.15 ? "negative" : score <= 0.15 ? "neutral" : score < 0.6 ? "positive" : "strong_positive";
}

export function groupStats(customers: Interview[]) {
  const weight = customers.reduce((sum, customer) => sum + WEIGHT[customer.tier], 0);
  return {
    count: customers.length,
    simple: customers.length ? customers.reduce((sum, customer) => sum + customer.sentiment, 0) / customers.length : 0,
    weighted: weight ? customers.reduce((sum, customer) => sum + WEIGHT[customer.tier] * customer.sentiment, 0) / weight : 0,
    positiveShare: customers.length ? Math.round((customers.filter((customer) => customer.sentiment > 0.15).length / customers.length) * 100) : 0,
  };
}

/** How many customers fall under each value (a customer counts once per value even if it is said twice). */
function countBy(customers: Interview[], pick: (customer: Interview) => string[]) {
  const table = new Map<string, number>();
  for (const customer of customers) for (const key of new Set(pick(customer))) table.set(key, (table.get(key) ?? 0) + 1);
  return table;
}

/** One horizontal bar per row: the filled part is the share of customers, and the count is always written out. */
function Bars({ rows, total, tone }: { rows: Array<{ key: string; label: string; count: number }>; total: number; tone?: (key: string) => string }) {
  return (
    <ul className="seg-bars">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="seg-bar-label">{row.label}</span>
          <span className="seg-bar-track" aria-hidden="true"><i className={tone ? tone(row.key) : ""} style={{ width: `${total ? Math.max(row.count ? 3 : 0, (row.count / total) * 100) : 0}%` }} /></span>
          <span className="seg-bar-value"><b>{row.count}</b> <small>{total ? `${Math.round((row.count / total) * 100)}%` : ""}</small></span>
        </li>
      ))}
    </ul>
  );
}

function IntentBar({ label, counts, total, names }: { label: string; counts: Record<Intent, number>; total: number; names: Record<Intent, string> }) {
  return (
    <div className="seg-intent">
      <span className="seg-intent-label">{label}</span>
      <div className="seg-stack" role="img" aria-label={`${label}: ${INTENTS.map((intent) => `${names[intent]} ${counts[intent]}`).join(", ")}`}>
        {INTENTS.map((intent) => counts[intent] > 0 && <i key={intent} className={`intent-${intent}`} style={{ width: `${(counts[intent] / total) * 100}%` }} title={`${names[intent]}: ${counts[intent]}`}>{counts[intent]}</i>)}
      </div>
    </div>
  );
}

/** The four bars (Newbie, Public, Expert, Overall) and, for the one clicked, what that group thinks and who its customers are. */
export function SegmentExplorer({ customers, value, onChange, onOpen }: { customers: Interview[]; value: Group; onChange: (group: Group) => void; onOpen: (customer: Interview) => void }) {
  const { t } = useI18n();
  const text = (key: string) => t[key as DictKey] ?? key;
  const stats = useMemo(() => Object.fromEntries(GROUPS.map((group) => [group, groupStats(group === "All" ? customers : customers.filter((customer) => customer.tier === group))])) as Record<Group, ReturnType<typeof groupStats>>, [customers]);
  const group = useMemo(() => (value === "All" ? customers : customers.filter((customer) => customer.tier === value)), [customers, value]);
  const analysed = useMemo(() => group.filter((customer) => customer.analysis), [group]);
  const profiled = useMemo(() => analysed.filter((customer) => customer.analysis!.profile), [analysed]);

  const distribution = useMemo(() => {
    const counts = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<(typeof BUCKETS)[number], number>;
    for (const customer of group) counts[bucketOf(customer.sentiment)] += 1;
    return counts;
  }, [group]);

  const intents = useMemo(() => {
    const blank = () => ({ yes: 0, maybe: 0, no: 0, unclear: 0 }) as Record<Intent, number>;
    const use = blank(), pay = blank();
    for (const customer of analysed) { use[customer.analysis!.wouldUse] += 1; pay[customer.analysis!.wouldPay] += 1; }
    return { use, pay };
  }, [analysed]);

  const transport = useMemo(() => countBy(profiled, (customer) => customer.analysis!.profile!.transport), [profiled]);
  const roles = useMemo(() => countBy(profiled, (customer) => [customer.analysis!.profile!.role]), [profiled]);
  const accidents = useMemo(() => countBy(profiled, (customer) => [customer.analysis!.profile!.accident]), [profiled]);
  const alternatives = useMemo(() => {
    const table = new Map<string, { name: string; people: number }>();
    for (const customer of analysed) for (const name of new Set(customer.analysis!.alternatives.map((item) => item.trim()).filter(Boolean))) {
      const row = table.get(canon(name)) ?? { name, people: 0 };
      row.people += 1;
      table.set(canon(name), row);
    }
    return [...table.values()].sort((a, b) => b.people - a.people).slice(0, 6);
  }, [analysed]);

  const rowsFrom = (order: readonly string[], table: Map<string, number>, prefix: string, keepZero = false) =>
    order.map((key) => ({ key, label: text(`${prefix}_${key}`), count: table.get(key) ?? 0 })).filter((row) => keepZero || row.count > 0).sort((a, b) => b.count - a.count);
  const intentNames = { yes: t.intent_yes, maybe: t.intent_maybe, no: t.intent_no, unclear: t.intent_unclear };
  const groupName = (key: Group) => (key === "All" ? t.sgOverall : text(`tier${key}`));
  const selected = stats[value];
  const tone = (score: number) => `tone-${sentimentTone(score)}`;

  return (
    <section className="seg" aria-labelledby="seg-title">
      <h2 id="seg-title">{t.sgTitle}</h2>
      <p className="tr-fine">{t.sgSub}</p>

      <div className="seg-tabs" role="tablist" aria-label={t.sgTitle}>
        {GROUPS.map((key) => {
          const row = stats[key];
          const score = key === "All" ? row.weighted : row.simple;
          const width = Math.abs(score) * 50;
          return (
            <button key={key} type="button" role="tab" id={`seg-tab-${key}`} aria-selected={value === key} aria-controls="seg-panel" className={`seg-tab${value === key ? " on" : ""}${key === "All" ? " seg-all" : ""}`} onClick={() => onChange(key)}>
              <span className="seg-name">{groupName(key)}</span>
              <span className="seg-meta">{row.count === 1 ? t.sgCountOne : format(t.sgCount, { n: row.count })}{key !== "All" && ` · ${format(t.sgWeight, { w: WEIGHT[key] })}`}</span>
              <span className="tr-bar" aria-hidden="true"><span className="tr-bar-mid" />{row.count > 0 && <i className={tone(score)} style={{ width: `${width}%`, left: score >= 0 ? "50%" : `${50 - width}%` }} />}</span>
              <b className={`seg-score ${tone(score)}`}>{row.count ? signed(score) : "—"}</b>
            </button>
          );
        })}
      </div>

      <div id="seg-panel" role="tabpanel" aria-labelledby={`seg-tab-${value}`}>
        {group.length === 0 ? <p className="tr-empty">{t.sgEmpty}</p> : <>
          <dl className="seg-stats">
            <div><dt>{t.total}</dt><dd>{selected.count}</dd></div>
            <div><dt>{t.simple}</dt><dd className={tone(selected.simple)}>{signed(selected.simple)}</dd></div>
            <div><dt>{t.weighted}</dt><dd className={tone(selected.weighted)}>{signed(selected.weighted)}</dd></div>
            <div><dt>{t.positive}</dt><dd>{format(t.sgPositiveShare, { pct: selected.positiveShare })}</dd></div>
          </dl>
          {analysed.length < group.length && <p className="tr-fine">{format(t.sgNeedAnalysis, { a: analysed.length, n: group.length })}</p>}

          <div className="seg-grid">
            <section className="tr-card" aria-labelledby="seg-dist">
              <h3 id="seg-dist">{t.sgDistribution}</h3>
              <Bars total={group.length} rows={BUCKETS.map((bucket) => ({ key: bucket, label: text(`sgBucket_${bucket}`), count: distribution[bucket] }))}
                tone={(key) => (key.includes("positive") ? "tone-positive" : key.includes("negative") ? "tone-negative" : "tone-neutral")} />
            </section>

            <section className="tr-card" aria-labelledby="seg-intent">
              <h3 id="seg-intent">{t.sgIntentTitle}</h3>
              {analysed.length === 0 ? <p className="tr-empty">{t.sgNoProfile}</p> : <>
                <IntentBar label={t.trWouldUse} counts={intents.use} total={analysed.length} names={intentNames} />
                <IntentBar label={t.trWouldPay} counts={intents.pay} total={analysed.length} names={intentNames} />
                <p className="tr-legend">{INTENTS.map((intent) => <span key={intent}><i className={`seg-swatch intent-${intent}`} />{intentNames[intent]}</span>)}</p>
              </>}
            </section>

            <section className="tr-card" aria-labelledby="seg-transport">
              <h3 id="seg-transport">{t.sgTransportTitle}</h3>
              {profiled.length === 0 ? <p className="tr-empty">{t.sgNoProfile}</p> : <>
                <Bars total={profiled.length} rows={rowsFrom(TRANSPORT, transport, "transport")} />
                <p className="tr-fine">{format(t.sgOf, { n: profiled.length, m: group.length })}</p>
              </>}
            </section>

            <section className="tr-card" aria-labelledby="seg-role">
              <h3 id="seg-role">{t.sgRoleTitle}</h3>
              {profiled.length === 0 ? <p className="tr-empty">{t.sgNoProfile}</p> : <Bars total={profiled.length} rows={rowsFrom(ROLES, roles, "role")} />}
            </section>

            <section className="tr-card" aria-labelledby="seg-accident">
              <h3 id="seg-accident">{t.sgAccidentTitle}</h3>
              {profiled.length === 0 ? <p className="tr-empty">{t.sgNoProfile}</p> : <Bars total={profiled.length} rows={rowsFrom(ACCIDENTS, accidents, "accident")} tone={(key) => (key === "none" ? "tone-neutral" : "tone-negative")} />}
            </section>

            <section className="tr-card" aria-labelledby="seg-alt">
              <h3 id="seg-alt">{t.sgAltTitle}</h3>
              {alternatives.length === 0 ? <p className="tr-empty">{t.sgAltEmpty}</p> : <Bars total={analysed.length} rows={alternatives.map((row) => ({ key: row.name, label: row.name, count: row.people }))} />}
            </section>
          </div>

          <MentionsBoard customers={group} onOpen={onOpen} />
        </>}
      </div>
    </section>
  );
}
