"use client";

import { useEffect, useMemo } from "react";
import { AreaLine, HBars, Radar, ScaleBar } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/components/I18nProvider";
import type { DictKey } from "@/lib/i18n";
import { TIERS, TOPICS, dateValue, signed, summarize, tierColor, type Customer, type Tier } from "@/lib/customers";

/** A report covers the overall set, one tier, a hand-picked selection, or a single customer (with the group as the comparison). */
export type ReportScope = { kind: "overall" | "tier" | "selection" | "customer"; title: string; customers: Customer[]; customer?: Customer };

/**
 * A full report on screen that prints to PDF. "Download PDF" opens the browser's print dialog; choose "Save as PDF" there.
 * Print styles hide the rest of the page, so the saved file contains only the report.
 */
export function DetailedReport({ scope, onClose }: { scope: ReportScope; onClose: () => void }) {
  const { lang, t } = useI18n();
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  const { customers, customer } = scope;
  const stats = useMemo(() => summarize(customers), [customers]);
  const timeline = useMemo(() => [...customers].sort((a, b) => dateValue(a.date) - dateValue(b.date)), [customers]);
  const ranked = useMemo(() => [...customers].sort((a, b) => a.sentiment - b.sentiment), [customers]);
  const positive = customers.filter((item) => item.sentiment > 0.15);
  const negative = customers.filter((item) => item.sentiment < -0.15);
  const neutral = customers.filter((item) => item.sentiment >= -0.15 && item.sentiment <= 0.15);
  const followUps = customers.filter((item) => item.sentiment <= 0.15);
  const generated = new Date().toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" });

  const tierName = (tier: Tier) => tier === "Expert" ? t.tierExpert : tier === "Public" ? t.tierPublic : t.tierNewbie;
  const topicName = (topic: string) => topic === "UX" ? t.topicUX : topic === "Pricing" ? t.topicPricing : t.topicFeatures;
  const wordFor = (score: number) => score > 0.15 ? L("positive", "सकारात्मक") : score < -0.15 ? L("negative", "नकारात्मक") : L("neutral", "तटस्थ");
  const verdictText = t[stats.verdict];
  const verdictDetail = t[`${stats.verdict}Detail` as DictKey];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The print dialog names the saved file after the document title, so it is set for the moment of printing.
  const download = () => {
    const previous = document.title;
    const slug = (customer?.name ?? scope.title).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, "-").replace(/^-|-$/g, "") || "report";
    document.title = `fieldnotes-${slug}-${new Date().toISOString().slice(0, 10)}`;
    window.print();
    document.title = previous;
  };

  const summaryText = customer
    ? L(
      `${customer.name} (${customer.company}, ${tierName(customer.tier)}) gave a ${wordFor(customer.sentiment)} view on ${customer.date}, scoring ${signed(customer.sentiment)} on a scale from −1 to +1. Compared with the group average of ${signed(stats.simple)}, this customer is ${customer.sentiment > stats.simple + 0.1 ? "more positive" : customer.sentiment < stats.simple - 0.1 ? "less positive" : "about the same"}.`,
      `${customer.name} (${customer.company}, ${tierName(customer.tier)}) ने ${customer.date} को ${wordFor(customer.sentiment)} राय दी, स्कोर ${signed(customer.sentiment)} (−1 से +1 के पैमाने पर)। समूह के औसत ${signed(stats.simple)} की तुलना में यह ${customer.sentiment > stats.simple + 0.1 ? "अधिक सकारात्मक" : customer.sentiment < stats.simple - 0.1 ? "कम सकारात्मक" : "लगभग समान"} है।`,
    )
    : L(
      `This report covers ${customers.length} customer${customers.length === 1 ? "" : "s"}. Overall sentiment is ${wordFor(stats.simple)} (simple average ${signed(stats.simple)}). Weighted by expertise it is ${signed(stats.weighted)}, which is ${wordFor(stats.weighted)}. ${verdictText}: ${verdictDetail}`,
      `इस रिपोर्ट में ${customers.length} ग्राहक शामिल हैं। कुल भावना ${wordFor(stats.simple)} है (सरल औसत ${signed(stats.simple)})। विशेषज्ञता के भार के साथ यह ${signed(stats.weighted)} है, जो ${wordFor(stats.weighted)} है। ${verdictText}: ${verdictDetail}`,
    );

  return <div className="report-overlay" role="dialog" aria-modal="true" aria-label={scope.title}>
    <div className="report-toolbar no-print">
      <div><strong>{L("Detailed report", "विस्तृत रिपोर्ट")}</strong><span>{L("Choose “Save as PDF” in the print window to keep a copy.", "प्रिंट विंडो में “Save as PDF” चुनकर PDF सहेजें।")}</span></div>
      <div className="report-toolbar-actions">
        <button className="button-primary" onClick={download}><Icon name="arrow" size={15} />{L("Download PDF", "PDF डाउनलोड करें")}</button>
        <button className="button-secondary" onClick={onClose}><Icon name="close" size={15} />{t.close}</button>
      </div>
    </div>

    <article className="report-print">
      <header className="report-head">
        <span className="report-brand">Fieldnotes · {L("Customer discovery report", "ग्राहक खोज रिपोर्ट")}</span>
        <h1>{customer ? customer.name : scope.title}</h1>
        <p className="report-muted">{customer ? `${customer.company} · ${tierName(customer.tier)} · ${customer.date}` : `${scope.title} · ${L("customers", "ग्राहक")}: ${customers.length}`}</p>
        <p className="report-muted">{L("Generated", "बनाई गई")}: {generated}</p>
      </header>

      {customers.length === 0 ? <p className="report-empty">{L("There are no interviews in this group yet. Add customer notes on the Upload page to build the report.", "इस समूह में अभी कोई इंटरव्यू नहीं है। रिपोर्ट बनाने के लिए अपलोड पेज पर ग्राहक नोट्स जोड़ें।")}</p> : <>

        <section className="report-section">
          <h2>{L("1. Summary", "1. सारांश")}</h2>
          <p>{summaryText}</p>
          <table className="report-table">
            <tbody>
              <tr><th>{t.simple} (S<sub>s</sub>)</th><td>{signed(stats.simple)}</td><th>{L("Positive", "सकारात्मक")}</th><td>{positive.length}</td></tr>
              <tr><th>{t.weighted} (S<sub>w</sub>)</th><td>{signed(stats.weighted)}</td><th>{L("Neutral", "तटस्थ")}</th><td>{neutral.length}</td></tr>
              <tr><th>{t.delta} (Δ)</th><td>{signed(stats.delta)}</td><th>{L("Negative", "नकारात्मक")}</th><td>{negative.length}</td></tr>
              <tr><th>{L("Verdict", "निष्कर्ष")}</th><td>{verdictText}</td><th>{L("Customers", "ग्राहक")}</th><td>{customers.length}</td></tr>
            </tbody>
          </table>
        </section>

        {scope.kind === "overall" && <section className="report-section">
          <h2>{L("2. Tier breakdown", "2. स्तर के अनुसार विश्लेषण")}</h2>
          <table className="report-table">
            <thead><tr><th>{L("Tier", "स्तर")}</th><th>{L("Customers", "ग्राहक")}</th><th>{t.simple}</th><th>{t.weighted}</th><th>{L("Positive share", "सकारात्मक हिस्सा")}</th></tr></thead>
            <tbody>{TIERS.map((tier) => {
              const group = customers.filter((item) => item.tier === tier);
              const groupStats = summarize(group);
              const share = group.length ? Math.round((group.filter((item) => item.sentiment > 0.15).length / group.length) * 100) : 0;
              return <tr key={tier}><td><span className="report-dot" style={{ background: tierColor(tier) }} />{tierName(tier)}</td><td>{group.length}</td><td>{group.length ? signed(groupStats.simple) : "—"}</td><td>{group.length ? signed(groupStats.weighted) : "—"}</td><td>{group.length ? `${share}%` : "—"}</td></tr>;
            })}</tbody>
          </table>
          <p className="report-note">{L("Weighted scores count an expert as 1.0, a public customer as 0.8 and a newbie as 0.5.", "भारित स्कोर में विशेषज्ञ का भार 1.0, सार्वजनिक ग्राहक का 0.8 और नए ग्राहक का 0.5 है।")}</p>
        </section>}

        <section className="report-section">
          <h2>{scope.kind === "overall" ? L("3. Topics", "3. विषय") : L("2. Topics", "2. विषय")}</h2>
          <div className="report-two">
            <Radar labels={TOPICS.map(topicName)} series={[{ name: t.weighted, values: stats.topics.map((topic) => topic.weighted) }, { name: t.simple, values: stats.topics.map((topic) => topic.simple), dashed: true }]} />
            <table className="report-table">
              <thead><tr><th>{L("Topic", "विषय")}</th><th>{t.weighted}</th><th>{t.simple}</th><th>{L("Reading", "अर्थ")}</th></tr></thead>
              <tbody>{stats.topics.map((topic) => <tr key={topic.name}><td>{topicName(topic.name)}</td><td>{signed(topic.weighted)}</td><td>{signed(topic.simple)}</td><td>{wordFor(topic.weighted)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="report-section">
          <h2>{scope.kind === "overall" ? L("4. Sentiment", "4. भावना") : L("3. Sentiment", "3. भावना")}</h2>
          <HBars rows={[{ label: t.positive, value: positive.length, color: "var(--s1)" }, { label: t.neutral, value: neutral.length, color: "var(--mid)" }, { label: t.negative, value: negative.length, color: "var(--s2)" }]} />
          {timeline.length > 1 && <div className="report-chart"><AreaLine points={timeline.map((item) => ({ label: item.date, value: item.sentiment }))} label={L("Sentiment over time", "समय के साथ भावना")} /></div>}
        </section>

        {customer ? <section className="report-section">
          <h2>{L("4. This customer", "4. यह ग्राहक")}</h2>
          <ScaleBar value={customer.sentiment} />
          <div className="report-two">
            <div>
              <h3>{L("Key points", "मुख्य बातें")}</h3>
              <ul className="report-list">{customer.keyPoints.map((point, index) => <li key={`${index}-${point}`} lang={customer.language === "hi" ? "hi" : "en"}>{point}</li>)}</ul>
            </div>
            <div>
              <h3>{L("Topics against the group", "समूह की तुलना में विषय")}</h3>
              <Radar labels={TOPICS.map(topicName)} series={[{ name: customer.name.split(" ")[0], values: TOPICS.map((topic) => customer.topics[topic]), color: tierColor(customer.tier) }, { name: L("Group average", "समूह औसत"), values: stats.topics.map((topic) => topic.simple), dashed: true }]} />
            </div>
          </div>
          <h3>{L("Transcript or notes", "ट्रांसक्रिप्ट या नोट्स")}</h3>
          <blockquote className="report-quote" lang={customer.language === "hi" ? "hi" : "en"}>{customer.transcript}</blockquote>
        </section> : <section className="report-section">
          <h2>{L("5. Customers", "5. ग्राहक")}</h2>
          <table className="report-table">
            <thead><tr><th>{L("Customer", "ग्राहक")}</th><th>{L("Company", "कंपनी")}</th><th>{L("Tier", "स्तर")}</th><th>{L("Date", "तारीख")}</th><th>{L("Score", "स्कोर")}</th></tr></thead>
            <tbody>{ranked.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.company}</td><td>{tierName(item.tier)}</td><td>{item.date}</td><td>{signed(item.sentiment)}</td></tr>)}</tbody>
          </table>
          <h3>{L("What each customer said", "हर ग्राहक ने क्या कहा")}</h3>
          {ranked.map((item) => <div className="report-customer" key={`card-${item.id}`}>
            <strong>{item.name} <span className="report-muted">· {item.company} · {tierName(item.tier)} · {signed(item.sentiment)}</span></strong>
            <ul className="report-list">{item.keyPoints.map((point, index) => <li key={`${item.id}-${index}`} lang={item.language === "hi" ? "hi" : "en"}>{point}</li>)}</ul>
          </div>)}
        </section>}

        <section className="report-section">
          <h2>{customer ? L("5. Concerns and follow-up", "5. चिंताएँ और अनुवर्ती कार्य") : scope.kind === "overall" ? L("6. Concerns and follow-up", "6. चिंताएँ और अनुवर्ती कार्य") : L("4. Concerns and follow-up", "4. चिंताएँ और अनुवर्ती कार्य")}</h2>
          <h3>{L("Negative responses", "नकारात्मक प्रतिक्रियाएँ")}</h3>
          {negative.length ? <ul className="report-list">{negative.map((item) => <li key={item.id}><strong>{item.name}</strong>: {item.keyPoints.join("; ")}</li>)}</ul> : <p className="report-muted">{L("No strongly negative responses.", "कोई मजबूत नकारात्मक प्रतिक्रिया नहीं।")}</p>}
          <h3>{L("Follow-up candidates (not clearly positive)", "अनुवर्ती कार्य के उम्मीदवार (स्पष्ट रूप से सकारात्मक नहीं)")}</h3>
          {followUps.length ? <ul className="report-list">{followUps.map((item) => <li key={`follow-${item.id}`}>{item.name} · {item.company} · {signed(item.sentiment)}</li>)}</ul> : <p className="report-muted">{L("Everyone in this group was clearly positive.", "इस समूह के सभी ग्राहक स्पष्ट रूप से सकारात्मक थे।")}</p>}
        </section>

        <section className="report-section report-method">
          <h2>{L("Method and accuracy", "पद्धति और सटीकता")}</h2>
          <p>{L("Sentiment is read from each saved transcript or note by Fieldnotes' built-in rules for English, Hindi and Hinglish. The score runs from −1 (very negative) to +1 (very positive). The simple average gives every customer equal weight; the weighted score counts experts more than newcomers. Topic scores come from what customers said about each topic.", "भावना का आकलन हर सेव किए गए ट्रांसक्रिप्ट या नोट से Fieldnotes के अंतर्निहित नियमों द्वारा किया जाता है (अंग्रेज़ी, हिंदी और हिंग्लिश)। स्कोर −1 (बहुत नकारात्मक) से +1 (बहुत सकारात्मक) तक है। सरल औसत हर ग्राहक को समान भार देता है; भारित स्कोर विशेषज्ञों को नए लोगों से अधिक भार देता है।")}</p>
          <p>{t.rpAccuracy}</p>
        </section>
      </>}
    </article>
  </div>;
}
