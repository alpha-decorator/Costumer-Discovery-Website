"use client";

import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/components/I18nProvider";
import { insightGroupTitle, insightsOf, mentionText, periodLabel, priceHeadline, priceStanceLabel, priceTone, rupees, type CustomerInsights } from "@/lib/insights";
import type { TrataAnalysis } from "@/lib/trata";

/**
 * Everything the rules found about one customer apart from the score: intent, prices, asks, worries, what they use
 * today and who they are. `variant="screen"` is the card in the customer panel and full report; `variant="print"` is
 * the numbered-table layout used in the PDF.
 */
export function CustomerInsightsView({ analysis, variant = "screen", lang: quoteLang }: { analysis: TrataAnalysis | null | undefined; variant?: "screen" | "print"; lang?: string }) {
  const { lang, t } = useI18n();
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  const text = (key: string) => t[key as DictKey] ?? key;
  const insights = insightsOf(analysis);
  if (!insights || !analysis) return null;
  const language = lang === "hi" ? "hi" : "en";
  const profile = analysis.profile;
  const profileRows: Array<[string, string]> = profile ? [
    [t.trRole, text(`role_${profile.role}`)],
    [t.trTransport, profile.transport.length ? profile.transport.map((mode) => text(`transport_${mode}`)).join(", ") : t.trNotSaid],
    [t.trAccident, text(`accident_${profile.accident}`)],
    [t.trUnderstood, text(`understanding_${profile.understanding}`)],
  ] : [];

  if (variant === "print") return <PrintInsights insights={insights} analysis={analysis} profileRows={profileRows} L={L} text={text} language={language} quoteLang={quoteLang} />;

  return <div className="fn-insights">
    <div className="fn-ins-intent">
      <IntentTile label={t.trWouldUse} value={insights.wouldUse} text={text} />
      <IntentTile label={t.trWouldPay} value={insights.wouldPay} text={text} />
      <div className="fn-ins-tile"><span>{t.trVerdictTitle}</span><b>{text(`verdict_${analysis.verdict}`)}</b></div>
    </div>

    {insights.prices.length > 0 && <div className="fn-ins-block">
      <span className="eyebrow">{L("Prices they talked about", "कीमतें जिनकी बात हुई")}</span>
      <ul className="fn-ins-prices">{insights.prices.map((price, index) => <li key={index} className={`tone-${priceTone(price.stance)}`}>
        <strong>{priceHeadline(price, language)}</strong>
        <em>{priceStanceLabel(price.stance, language)}{price.who === "interviewer" ? L(" · asked by interviewer", " · इंटरव्यूअर ने पूछा") : ""}</em>
        <q lang={quoteLang}>{price.text}</q>
      </li>)}</ul>
    </div>}

    {insights.groups.filter((group) => group.key !== "pricing").map((group) => <div className={`fn-ins-block fn-ins-${group.key}`} key={group.key}>
      <span className="eyebrow">{insightGroupTitle(group.key, language)} <b>{group.items.length}</b></span>
      <ul className="fn-ins-list">{group.items.map((mention, index) => <li key={index}><small>{text(`mention_${mention.type}`)}</small><span lang={quoteLang}>{mentionText(mention)}</span></li>)}</ul>
    </div>)}

    {insights.alternatives.length > 0 && <div className="fn-ins-block">
      <span className="eyebrow">{L("What they use today", "वे अभी क्या इस्तेमाल करते हैं")}</span>
      <div className="fn-ins-tags">{insights.alternatives.map((name) => <span key={name}>{name}</span>)}</div>
    </div>}

    {profileRows.length > 0 && <div className="fn-ins-block">
      <span className="eyebrow">{t.trProfileTitle}</span>
      <dl className="fn-ins-profile">{profileRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>}

    {analysis.features.length > 0 && <div className="fn-ins-block">
      <span className="eyebrow">{t.trFeaturesTitle}</span>
      <div className="fn-ins-tags">{analysis.features.map((feature) => <span key={feature.name} className={`tone-${feature.score > 0.15 ? "pos" : feature.score < -0.15 ? "neg" : "neu"}`}>{feature.name} · {text(`stance_${feature.stance}`)}</span>)}</div>
    </div>}
  </div>;
}

function IntentTile({ label, value, text }: { label: string; value: string; text: (key: string) => string }) {
  return <div className={`fn-ins-tile intent-${value}`}><span>{label}</span><b>{text(`intent_${value}`)}</b></div>;
}

function PrintInsights({ insights, analysis, profileRows, L, text, language, quoteLang }: { insights: CustomerInsights; analysis: TrataAnalysis; profileRows: Array<[string, string]>; L: (en: string, hi: string) => string; text: (key: string) => string; language: "en" | "hi"; quoteLang?: string }) {
  return <>
    <h3>{L("Decision signals", "निर्णय के संकेत")}</h3>
    <div className="report-kpis">
      <div className={`report-kpi intent-${insights.wouldUse}`}><span>{L("Would use", "इस्तेमाल करेंगे")}</span><b>{text(`intent_${insights.wouldUse}`)}</b></div>
      <div className={`report-kpi intent-${insights.wouldPay}`}><span>{L("Would pay", "भुगतान करेंगे")}</span><b>{text(`intent_${insights.wouldPay}`)}</b></div>
      <div className="report-kpi"><span>{L("Verdict", "निष्कर्ष")}</span><b>{text(`verdict_${analysis.verdict}`)}</b></div>
      <div className="report-kpi"><span>{L("Concern about the problem", "समस्या को लेकर चिंता")}</span><b>{text(`level_${analysis.problemConcern.level}`)}</b></div>
    </div>

    <h3>{L("Prices discussed", "कीमतों पर बात")}</h3>
    {insights.prices.length ? <table className="report-table">
      <thead><tr><th>{L("Amount", "राशि")}</th><th>{L("Period", "अवधि")}</th><th>{L("Reaction", "प्रतिक्रिया")}</th><th>{L("In their words", "उनके शब्दों में")}</th></tr></thead>
      <tbody>{insights.prices.map((price, index) => <tr key={index}>
        <td><b>{price.limit === "max" ? (price.stance === "too_high" ? "> " : "≤ ") : ""}{rupees(price.amount)}</b></td>
        <td>{periodLabel(price.period, language)}</td>
        <td><span className={`report-tag tone-${priceTone(price.stance)}`}>{priceStanceLabel(price.stance, language)}</span>{price.who === "interviewer" && <small className="report-muted"> {L("(price asked by interviewer)", "(कीमत इंटरव्यूअर ने पूछी)")}</small>}</td>
        <td lang={quoteLang}>“{price.text}”</td>
      </tr>)}</tbody>
    </table> : <p className="report-muted">{L("No amounts of money were named in this call.", "इस बातचीत में कोई राशि नहीं बताई गई।")}</p>}

    {insights.groups.filter((group) => group.key !== "pricing").map((group) => <div key={group.key}>
      <h3>{insightGroupTitle(group.key, language)}</h3>
      <table className="report-table report-table-tight">
        <tbody>{group.items.map((mention, index) => <tr key={index}><th>{text(`mention_${mention.type}`)}</th><td lang={quoteLang}>{mentionText(mention)}</td></tr>)}</tbody>
      </table>
    </div>)}

    {insights.alternatives.length > 0 && <>
      <h3>{L("What they use today", "वे अभी क्या इस्तेमाल करते हैं")}</h3>
      <p>{insights.alternatives.map((name) => <span className="report-tag" key={name}>{name}</span>)}</p>
    </>}

    {profileRows.length > 0 && <>
      <h3>{L("Who they are", "वे कौन हैं")}</h3>
      <table className="report-table"><tbody>{pairs(profileRows).map((row, index) => <tr key={index}>{row.flatMap(([label, value]) => [<th key={`${label}-k`}>{label}</th>, <td key={`${label}-v`}>{value}</td>])}</tr>)}</tbody></table>
    </>}

    {analysis.features.length > 0 && <>
      <h3>{L("Opinions on features", "फ़ीचर पर राय")}</h3>
      <table className="report-table">
        <thead><tr><th>{L("Feature", "फ़ीचर")}</th><th>{L("Opinion", "राय")}</th><th>{L("Score", "स्कोर")}</th><th>{L("Quote", "उद्धरण")}</th></tr></thead>
        <tbody>{analysis.features.map((feature) => <tr key={feature.name}><td>{feature.name}</td><td>{text(`stance_${feature.stance}`)}</td><td>{feature.score >= 0 ? "+" : ""}{feature.score.toFixed(2)}</td><td lang={quoteLang}>{feature.evidence ? `“${feature.evidence.text}”` : "—"}</td></tr>)}</tbody>
      </table>
    </>}

    {analysis.qa && analysis.qa.length > 0 && <>
      <h3>{L("Questions and answers", "सवाल और जवाब")}</h3>
      <table className="report-table report-qa">
        <thead><tr><th>{L("Interviewer asked", "इंटरव्यूअर ने पूछा")}</th><th>{L("Customer answered", "ग्राहक ने जवाब दिया")}</th><th>{L("Tone", "भाव")}</th></tr></thead>
        <tbody>{analysis.qa.map((item, index) => <tr key={index}><td lang={quoteLang}>{item.question || "—"}</td><td lang={quoteLang}>{item.answer}</td><td>{text(`tone_${item.tone}`)}</td></tr>)}</tbody>
      </table>
    </>}
  </>;
}

function pairs<T>(rows: T[]): T[][] { const out: T[][] = []; for (let index = 0; index < rows.length; index += 2) out.push(rows.slice(index, index + 2)); return out; }
