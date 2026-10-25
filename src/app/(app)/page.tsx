"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DetailedReport, type ReportScope } from "@/components/DetailedReport";
import { AreaLine, Donut, HBars, Radar } from "@/components/Charts";
import { useI18n } from "@/components/I18nProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { Icon } from "@/components/Icon";
import { TIERS, TOPICS, dateValue, initialsColor, signed, summarize, tierColor, type Tier, type TierFilter } from "@/lib/customers";
import { peekOrgNotice } from "@/lib/org-notice";

export default function HomePage() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const { loaded, customers, tierFilter, setTierFilter, setSelectedIds } = useWorkspace();
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  // Creating or joining a business reloads the page; the business screen then shows the result.
  useEffect(() => { if (peekOrgNotice()) router.replace("/business"); }, [router]);

  const inView = useMemo(() => customers.filter((customer) => tierFilter === "All" || customer.tier === tierFilter), [customers, tierFilter]);
  const stats = useMemo(() => summarize(inView), [inView]);
  const timeline = useMemo(() => [...inView].sort((a, b) => dateValue(a.date) - dateValue(b.date)), [inView]);
  const recent = useMemo(() => [...customers].sort((a, b) => dateValue(b.date) - dateValue(a.date)).slice(0, 5), [customers]);
  const tierName = (tier: TierFilter) => tier === "Expert" ? t.tierExpert : tier === "Public" ? t.tierPublic : tier === "Newbie" ? t.tierNewbie : t.all;
  const topicName = (topic: string) => topic === "UX" ? t.topicUX : topic === "Pricing" ? t.topicPricing : t.topicFeatures;
  const countTier = (tier: Tier) => customers.filter((customer) => customer.tier === tier).length;
  const positive = inView.filter((customer) => customer.sentiment > 0.15).length;
  const negative = inView.filter((customer) => customer.sentiment < -0.15).length;
  const neutral = inView.length - positive - negative;
  const tone = (score: number) => score > 0.15 ? "tone-pos" : score < -0.15 ? "tone-neg" : "tone-neu";
  const chips: Array<{ value: TierFilter; label: string; count: number }> = [
    { value: "All", label: L("Global view", "सामान्य दृश्य"), count: customers.length },
    ...TIERS.map((tier) => ({ value: tier, label: tierName(tier), count: countTier(tier) })),
  ];
  const choose = (value: TierFilter) => { setTierFilter(value); setSelectedIds([]); };
  const verdictKey = stats.verdict;
  const [report, setReport] = useState<ReportScope | null>(null);

  const reportScope: ReportScope = tierFilter === "All"
    ? { kind: "overall", title: L("Overall insights", "सामान्य अंतर्दृष्टि"), customers }
    : { kind: "tier", title: tierName(tierFilter), customers: inView };

  return <AppShell title={t.discover} intro={t.intro} actions={<button className="button-primary" onClick={() => setReport(reportScope)}><Icon name="arrow" size={15} />{L("Detailed report & PDF", "विस्तृत रिपोर्ट और PDF")}</button>}>
    <div className="fn-chips" role="tablist" aria-label={t.filter}>
      {chips.map((chip) => <button key={chip.value} role="tab" aria-selected={tierFilter === chip.value} className={tierFilter === chip.value ? "on" : ""} onClick={() => choose(chip.value)}>{chip.label} <b>{chip.count}</b></button>)}
    </div>

    <section className="fn-kpis" aria-label={t.selectedView}>
      <article className="fn-kpi"><span>{t.weighted} (S<sub>w</sub>)</span><strong className={tone(stats.weighted)}>{signed(stats.weighted)}</strong><small>{stats.count ? `${t[verdictKey]} · ${L("weighted by expertise", "विशेषज्ञता के अनुसार भारित")}` : t.noSelection}</small></article>
      <article className="fn-kpi"><span>{t.simple} (S<sub>s</sub>)</span><strong className={tone(stats.simple)}>{signed(stats.simple)}</strong><small>{t.sentimentRange}</small></article>
      <article className="fn-kpi"><span>{t.delta} (Δ)</span><strong className={stats.delta >= 0 ? "tone-pos" : "tone-neg"}>{signed(stats.delta)}</strong><small>{t[`${verdictKey}Detail`]}</small></article>
      <article className="fn-kpi"><span>{t.customersCovered}</span><strong>{inView.length}</strong><small>{TIERS.map((tier) => `${tierName(tier)} ${inView.filter((customer) => customer.tier === tier).length}`).join(" · ")}</small></article>
    </section>

    <section className="fn-grid">
      <article className="fn-card">
        <h2>{t.topicHeading}</h2>
        <p className="fn-card-sub">{t.topicSub}</p>
        {inView.length ? <>
          <Radar labels={TOPICS.map(topicName)} series={[
            { name: t.weighted, values: stats.topics.map((topic) => topic.weighted) },
            { name: t.simple, values: stats.topics.map((topic) => topic.simple), dashed: true },
          ]} />
          <ul className="fn-table-list">{stats.topics.map((topic) => <li key={topic.name}><span>{topicName(topic.name)}</span><b className={tone(topic.weighted)}>{signed(topic.weighted)}</b><small>{signed(topic.simple)}</small></li>)}</ul>
        </> : <p className="no-points">{t.noSelection}</p>}
      </article>

      <article className="fn-card fn-wide">
        <h2>{L("Sentiment timeline & demographics", "भावना की समय-रेखा")}</h2>
        <p className="fn-card-sub">{t.sentimentRange}</p>
        {timeline.length ? <AreaLine points={timeline.map((customer) => ({ label: customer.date, value: customer.sentiment }))} label={L("Sentiment over time", "समय के साथ भावना")} /> : <p className="no-points">{t.noSelection}</p>}
      </article>

      <article className="fn-card">
        <h2>{t.tier}</h2>
        <p className="fn-card-sub">{t.sentimentRange}</p>
        <Donut label={t.tier} centre={String(inView.length)} parts={TIERS.map((tier) => ({ label: tierName(tier), value: inView.filter((customer) => customer.tier === tier).length, color: tierColor(tier) }))} />
      </article>

      <article className="fn-card">
        <h2>{t.sentimentBreakdown}</h2>
        <p className="fn-card-sub">{t.sentimentRange}</p>
        <HBars rows={[
          { label: t.positive, value: positive, color: "var(--s1)" },
          { label: t.neutral, value: neutral, color: "var(--mid)" },
          { label: t.negative, value: negative, color: "var(--s2)" },
        ]} />
        <div className={`fn-verdict verdict-${verdictKey}`}><strong>{t[verdictKey]}</strong><p>{t[`${verdictKey}Detail`]}</p></div>
      </article>

      <article className="fn-card fn-wide">
        <div className="fn-row-head"><div><h2>{t.customerPoints}</h2><p className="fn-card-sub">{t.pointsSub}</p></div><Link className="text-link" href="/customers">{t.seeAll}</Link></div>
        <div className="points-list">
          {recent.map((customer) => <Link className="customer-point" key={customer.id} href={`/customers?open=${encodeURIComponent(customer.id)}`}>
            <span className={`avatar avatar-${initialsColor(customer.name)}`}>{customer.initials}</span>
            <span className="point-copy"><strong>{customer.name}<small> · {customer.company}</small></strong><span lang={customer.language}>{customer.keyPoints[0]}</span></span>
            <span className={`tier-pill tier-${customer.tier.toLowerCase()}`}><i />{tierName(customer.tier)}</span>
            <span className={`point-sentiment ${tone(customer.sentiment)}`}>{signed(customer.sentiment)}</span>
          </Link>)}
        </div>
        {!loaded && <p className="fn-card-sub">{L("Loading your interviews…", "आपके इंटरव्यू लोड हो रहे हैं…")}</p>}
      </article>
    </section>
    {report && <DetailedReport scope={report} onClose={() => setReport(null)} />}
  </AppShell>;
}
