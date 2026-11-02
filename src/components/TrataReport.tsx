"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { format, type DictKey } from "@/lib/i18n";
import type { Interview } from "@/lib/interviews";
import { MENTION_TYPES, sentimentTone, type Evidence, type MentionType, type TrataAnalysis } from "@/lib/trata";
import { priceHeadline, priceStanceLabel, priceTone } from "@/lib/insights";

type Topics = { UX: number; Pricing: number; Features: number };
type Props = { customer: Interview; reference?: Topics | null; onClose: () => void; onManage?: () => void };
type Pick = { kind: "idea" | "feature" | "mention"; index: number };
type Highlight = { key: string; kind: Pick["kind"]; index: number; start: number; end: number; tone: "positive" | "negative" | "neutral"; evidence: Evidence };

const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
const ENGINE_NAMES: Record<string, string> = { "indic-conformer": "IndicConformer", "faster-whisper": "Whisper" };

export function ScoreGauge({ score, label }: { score: number; label: string }) {
  const position = ((Math.max(-1, Math.min(1, score)) + 1) / 2) * 100;
  return (
    <div className="tr-gauge" role="img" aria-label={label}>
      <div className="tr-gauge-track"><span className="tr-gauge-zero" /><i className={`tr-gauge-dot tone-${sentimentTone(score)}`} style={{ left: `${position}%` }} /></div>
      <div className="tr-gauge-scale"><span>−1</span><span>0</span><span>+1</span></div>
    </div>
  );
}

/** Three-axis radar: the centre ring is 0 (no opinion), the outer ring +1. Dashed = the average of all customers. */
function Radar({ values, reference, notDiscussed, names }: { values: Topics; reference?: Topics | null; notDiscussed: string[]; names: Record<keyof Topics, string> }) {
  const centre = { x: 120, y: 105 }, radius = 70;
  const axes = (["UX", "Pricing", "Features"] as const).map((key, index) => ({ key, angle: (-90 + index * 120) * Math.PI / 180 }));
  const point = (angle: number, score: number) => {
    const r = ((Math.max(-1, Math.min(1, score)) + 1) / 2) * radius;
    return `${(centre.x + Math.cos(angle) * r).toFixed(1)},${(centre.y + Math.sin(angle) * r).toFixed(1)}`;
  };
  const ring = (fraction: number) => axes.map(({ angle }) => `${(centre.x + Math.cos(angle) * radius * fraction).toFixed(1)},${(centre.y + Math.sin(angle) * radius * fraction).toFixed(1)}`).join(" ");
  const polygon = (topics: Topics) => axes.map(({ key, angle }) => point(angle, topics[key])).join(" ");
  return (
    <svg className="tr-radar" viewBox="0 0 240 215" role="img" aria-label={axes.map(({ key }) => `${names[key]} ${signed(values[key])}`).join(", ")}>
      {[0.25, 0.5, 0.75, 1].map((fraction) => <polygon key={fraction} points={ring(fraction)} className={fraction === 0.5 ? "tr-ring tr-ring-zero" : "tr-ring"} />)}
      {axes.map(({ key, angle }) => <line key={key} x1={centre.x} y1={centre.y} x2={centre.x + Math.cos(angle) * radius} y2={centre.y + Math.sin(angle) * radius} className="tr-axis" />)}
      {reference && <polygon points={polygon(reference)} className="tr-poly-ref" />}
      <polygon points={polygon(values)} className="tr-poly" />
      {axes.map(({ key, angle }) => {
        const x = centre.x + Math.cos(angle) * (radius + 20), y = centre.y + Math.sin(angle) * (radius + 16);
        const missing = notDiscussed.includes(key);
        return <text key={key} x={x} y={y} textAnchor="middle" className={missing ? "tr-axis-label tr-dim" : "tr-axis-label"}>
          <tspan x={x} dy="0">{names[key]}</tspan><tspan x={x} dy="13" className="tr-axis-score">{missing ? "—" : signed(values[key])}</tspan>
        </text>;
      })}
    </svg>
  );
}

function highlightsFor(transcript: string, analysis: TrataAnalysis): Highlight[] {
  const found: Highlight[] = [];
  const place = (evidence: Evidence | null | undefined, kind: Pick["kind"], index: number, tone: Highlight["tone"]) => {
    if (!evidence?.verified || !evidence.text) return;
    const target = (evidence.pos ?? 0) * transcript.length;
    let best = -1, at = transcript.indexOf(evidence.text);
    while (at !== -1) {
      if (best === -1 || Math.abs(at - target) < Math.abs(best - target)) best = at;
      at = transcript.indexOf(evidence.text, at + 1);
    }
    if (best >= 0) found.push({ key: `${kind}-${index}`, kind, index, start: best, end: best + evidence.text.length, tone, evidence });
  };
  analysis.ideaSentiment.evidence.forEach((evidence, index) => place(evidence, "idea", index, sentimentTone(analysis.ideaSentiment.score)));
  analysis.features.forEach((feature, index) => place(feature.evidence, "feature", index, sentimentTone(feature.score)));
  analysis.mentions.forEach((mention, index) => place(mention.evidence, "mention", index, "neutral"));
  found.sort((a, b) => a.start - b.start);
  const kept: Highlight[] = [];
  for (const item of found) if (!kept.length || item.start >= kept[kept.length - 1].end) kept.push(item);
  return kept;
}

export function TrataReport({ customer, reference, onClose, onManage }: Props) {
  const { t, lang } = useI18n();
  const analysis = customer.analysis;
  const [picked, setPicked] = useState<Pick | null>(null);
  const [mentionFilter, setMentionFilter] = useState<MentionType | "all">("all");
  const [openFeature, setOpenFeature] = useState<number | null>(null);
  const markRefs = useRef(new Map<string, HTMLElement>());
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);

  const highlights = useMemo(() => analysis ? highlightsFor(customer.transcript, analysis) : [], [analysis, customer.transcript]);
  const segments = useMemo(() => {
    const parts: Array<{ text: string; highlight?: Highlight }> = [];
    let cursor = 0;
    for (const item of highlights) {
      if (item.start > cursor) parts.push({ text: customer.transcript.slice(cursor, item.start) });
      parts.push({ text: customer.transcript.slice(item.start, item.end), highlight: item });
      cursor = item.end;
    }
    if (cursor < customer.transcript.length) parts.push({ text: customer.transcript.slice(cursor) });
    return parts;
  }, [highlights, customer.transcript]);

  // Speaker turns are character offsets into the transcript; ignore them if the transcript was edited and no longer lines up.
  const turns = useMemo(() => {
    const list = analysis?.turns;
    return list && list.length && list.every((turn) => turn.e <= customer.transcript.length) ? list : null;
  }, [analysis, customer.transcript]);
  const customerShare = useMemo(() => {
    if (!turns) return 0;
    const words = (from: number, to: number) => customer.transcript.slice(from, to).split(/\s+/).filter(Boolean).length;
    const mine = turns.filter((turn) => turn.who === "C").reduce((sum, turn) => sum + words(turn.s, turn.e), 0);
    const all = turns.reduce((sum, turn) => sum + words(turn.s, turn.e), 0);
    return all ? Math.round((mine / all) * 100) : 0;
  }, [turns, customer.transcript]);
  const partsIn = (from: number, to: number) => {
    const parts: Array<{ text: string; highlight?: Highlight; first?: boolean }> = [];
    let cursor = from;
    for (const item of highlights) {
      if (item.end <= from || item.start >= to) continue;
      const start = Math.max(item.start, from), end = Math.min(item.end, to);
      if (start > cursor) parts.push({ text: customer.transcript.slice(cursor, start) });
      parts.push({ text: customer.transcript.slice(start, end), highlight: item, first: item.start >= from });
      cursor = end;
    }
    if (cursor < to) parts.push({ text: customer.transcript.slice(cursor, to) });
    return parts;
  };
  const renderPart = (part: { text: string; highlight?: Highlight; first?: boolean }, index: number) => part.highlight
    ? <mark key={index} ref={(node) => { if (node && part.first !== false) markRefs.current.set(part.highlight!.key, node); }} className={`tone-${part.highlight.tone}${picked && `${picked.kind}-${picked.index}` === part.highlight.key ? " selected" : ""}`}
        onClick={() => select({ kind: part.highlight!.kind, index: part.highlight!.index })}>{part.text}</mark>
    : <span key={index}>{part.text}</span>;

  const select = (next: Pick, scroll = false) => {
    setPicked(next);
    if (scroll) markRefs.current.get(`${next.kind}-${next.index}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const topicNames = { UX: t.topicUX, Pricing: t.topicPricing, Features: t.topicFeatures };
  const text = (key: string) => t[key as DictKey] ?? key;
  const lines = lang === "hi" ? "hi" : "en";
  const quoteLang = customer.language === "hi" ? "hi" : customer.language === "mixed" ? undefined : "en";
  const topics = analysis ? { UX: analysis.topics.UX.score, Pricing: analysis.topics.Pricing.score, Features: analysis.topics.Features.score } : customer.topics;
  const notDiscussed = analysis ? (["UX", "Pricing", "Features"] as const).filter((key) => !analysis.topics[key].discussed) : [];

  // Items for the conversation map: verified quotes only, because only those have a trustworthy position.
  const mapItems = useMemo(() => !analysis ? [] : [
    ...analysis.ideaSentiment.evidence.map((evidence, index) => ({ kind: "idea" as const, index, evidence, tone: sentimentTone(analysis.ideaSentiment.score), label: t.trMapIdea })),
    ...analysis.features.map((feature, index) => ({ kind: "feature" as const, index, evidence: feature.evidence, tone: sentimentTone(feature.score), label: feature.name })),
    ...analysis.mentions.map((mention, index) => ({ kind: "mention" as const, index, evidence: mention.evidence, tone: "neutral" as const, label: mention.text })),
  ].filter((item) => item.evidence?.verified && item.evidence.pos !== null), [analysis, t.trMapIdea]);

  const pickedDetail = (() => {
    if (!analysis || !picked) return null;
    if (picked.kind === "idea") return { title: t.trIdeaEvidence, body: analysis.ideaSentiment.reasoning, evidence: analysis.ideaSentiment.evidence[picked.index] };
    if (picked.kind === "feature") { const feature = analysis.features[picked.index]; return feature ? { title: feature.name, body: `${text(`stance_${feature.stance}`)} ${signed(feature.score)}`, evidence: feature.evidence } : null; }
    const mention = analysis.mentions[picked.index];
    return mention ? { title: text(`mention_${mention.type}`), body: mention.text, evidence: mention.evidence } : null;
  })();

  const durationText = analysis?.meta.durationSec ? format(t.trDuration, { m: Math.max(1, Math.round(analysis.meta.durationSec / 60)) }) : "";
  const asrName = analysis?.meta.asrEngine === "text" ? t.trEngineText : ENGINE_NAMES[analysis?.meta.asrEngine ?? ""] ?? analysis?.meta.asrEngine ?? "";
  const mentionTypes = analysis ? MENTION_TYPES.filter((type) => analysis.mentions.some((mention) => mention.type === type)) : [];
  const shownMentions = analysis ? analysis.mentions.map((mention, index) => ({ mention, index })).filter(({ mention }) => mentionFilter === "all" || mention.type === mentionFilter) : [];
  const tone = analysis ? sentimentTone(analysis.ideaSentiment.score) : sentimentTone(customer.sentiment);

  return (
    <div className="modal-backdrop tr-backdrop" role="presentation" onClick={onClose}>
      <section className="tr-report" role="dialog" aria-modal="true" aria-labelledby="tr-title" tabIndex={-1} ref={dialogRef} lang={lines} onClick={(event) => event.stopPropagation()}>
        <header className="tr-head">
          <div className="tr-who">
            <span className="eyebrow">{t.trReportTitle}</span>
            <h2 id="tr-title">{customer.name}</h2>
            <p>{customer.company} · {text(`tier${customer.tier}`)} · {customer.date}</p>
          </div>
          <div className="tr-head-actions no-print">
            <button type="button" className="button-secondary" onClick={() => window.print()}>{t.trPrint}</button>
            {onManage && <button type="button" className="button-secondary" onClick={onManage}>{t.trManage}</button>}
            <button type="button" className="button-secondary" onClick={onClose} aria-label={t.close}>{t.close}</button>
          </div>
        </header>

        {!analysis && <>
          <p className="tr-note">{t.trNoAnalysis}</p>
          <div className="tr-grid"><section className="tr-card"><h3>{t.trVerdictTitle}</h3><p className={`tr-score tone-${tone}`}>{signed(customer.sentiment)}</p><ScoreGauge score={customer.sentiment} label={signed(customer.sentiment)} /></section>
            <section className="tr-card"><h3>{t.trTopicsTitle}</h3><Radar values={topics} reference={reference} notDiscussed={[]} names={topicNames} /></section></div>
        </>}

        {analysis && <>
          {analysis.flags.needsReview && (
            <div className="tr-review" role="alert"><strong>{t.trReview}</strong> {t.trReviewHelp}
              <ul>{analysis.flags.reasons.map((reason) => <li key={reason}>{t[`reason_${reason}` as DictKey] ?? reason}</li>)}</ul>
            </div>
          )}

          <div className="tr-grid">
            <section className="tr-card tr-verdict" aria-labelledby="tr-verdict-title">
              <h3 id="tr-verdict-title">{t.trVerdictTitle}</h3>
              <p className={`tr-score tone-${tone}`}>{analysis.ideaSentiment.label === "not_discussed" ? "—" : signed(analysis.ideaSentiment.score)}</p>
              <p className={`tr-verdict-text tone-${tone}`}>{text(`verdict_${analysis.verdict}`)}</p>
              <ScoreGauge score={analysis.ideaSentiment.score} label={`${t.trVerdictTitle}: ${signed(analysis.ideaSentiment.score)}`} />
              <div className="tr-chips">
                <span className={`tr-chip intent-${analysis.wouldUse}`}>{t.trWouldUse}: <b>{text(`intent_${analysis.wouldUse}`)}</b></span>
                <span className={`tr-chip intent-${analysis.wouldPay}`}>{t.trWouldPay}: <b>{text(`intent_${analysis.wouldPay}`)}</b></span>
              </div>
              <p className="tr-fine">{t.trScoreNote}</p>
              {analysis.ideaSentiment.reasoning && <p className="tr-why"><b>{t.trReasoning}:</b> {analysis.ideaSentiment.reasoning}</p>}
            </section>

            <section className="tr-card" aria-labelledby="tr-topics-title">
              <h3 id="tr-topics-title">{t.trTopicsTitle}</h3>
              <Radar values={topics} reference={reference} notDiscussed={notDiscussed} names={topicNames} />
              <p className="tr-legend"><span className="tr-key tr-key-solid" />{t.trThisCustomer}{reference && <><span className="tr-key tr-key-dash" />{t.trGroupAverage}</>}</p>
              <div className="tr-concern">
                <h4>{t.trConcernTitle}</h4>
                <div className="tr-meter" role="img" aria-label={`${t.trConcernTitle}: ${text(`level_${analysis.problemConcern.level}`)}`}>
                  {["low", "medium", "high"].map((level, index) => <i key={level} className={index < ["none", "low", "medium", "high"].indexOf(analysis.problemConcern.level) ? "on" : ""} />)}
                  <b>{text(`level_${analysis.problemConcern.level}`)}</b>
                </div>
                <p className="tr-fine">{analysis.problemConcern.note || t.trConcernNote}</p>
              </div>
            </section>
          </div>

          {analysis.summary && <section className="tr-card tr-wide"><h3>{t.trSummary}</h3><p>{analysis.summary}</p>
            {analysis.keyPoints.length > 0 && <ul className="tr-points">{analysis.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul>}</section>}

          {analysis.prices && analysis.prices.length > 0 && (
            <section className="tr-card tr-wide" aria-labelledby="tr-prices-title">
              <h3 id="tr-prices-title">{lang === "hi" ? "कीमतें जिनकी बात हुई" : "Prices they talked about"}</h3>
              <ul className="fn-ins-prices">{analysis.prices.map((price, index) => <li key={index} className={`tone-${priceTone(price.stance)}`}>
                <strong>{priceHeadline(price, lang === "hi" ? "hi" : "en")}</strong>
                <em>{priceStanceLabel(price.stance, lang === "hi" ? "hi" : "en")}{price.who === "interviewer" ? (lang === "hi" ? " · इंटरव्यूअर ने पूछा" : " · asked by interviewer") : ""}</em>
                <q lang={quoteLang}>{price.text}</q>
              </li>)}</ul>
            </section>
          )}

          {analysis.profile && (
            <section className="tr-card tr-wide" aria-labelledby="tr-profile-title">
              <h3 id="tr-profile-title">{t.trProfileTitle}</h3>
              <dl className="tr-profile">
                <div><dt>{t.trRole}</dt><dd>{text(`role_${analysis.profile.role}`)}</dd></div>
                <div><dt>{t.trTransport}</dt><dd>{analysis.profile.transport.length ? analysis.profile.transport.map((mode) => text(`transport_${mode}`)).join(", ") : t.trNotSaid}</dd></div>
                <div><dt>{t.trAccident}</dt><dd>{text(`accident_${analysis.profile.accident}`)}</dd></div>
                <div><dt>{t.trUnderstood}</dt><dd>{text(`understanding_${analysis.profile.understanding}`)}</dd></div>
              </dl>
            </section>
          )}

          {analysis.qa && analysis.qa.length > 0 && (
            <section className="tr-card tr-wide" aria-labelledby="tr-qa-title">
              <h3 id="tr-qa-title">{t.trQaTitle}</h3>
              <p className="tr-fine">{t.trQaSub}</p>
              <ol className="tr-qa">
                {analysis.qa.map((item, index) => (
                  <li key={index}>
                    {item.question && <p className="tr-q"><b>{t.trSpeakerInterviewer}:</b> {item.question}</p>}
                    <p className="tr-a"><b>{t.trSpeakerCustomer}:</b> {item.answer} <span className={`tr-tone tr-tone-${item.tone}`}>{text(`tone_${item.tone}`)}</span></p>
                    {item.evidence && <blockquote className={item.evidence.verified ? "" : "tr-unverified"} lang={quoteLang}>“{item.evidence.text}”{!item.evidence.verified && <small>{t.trUnverified}</small>}</blockquote>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="tr-card tr-wide" aria-labelledby="tr-features-title">
            <h3 id="tr-features-title">{t.trFeaturesTitle}</h3>
            {analysis.features.length === 0 ? <p className="tr-empty">{t.trFeaturesEmpty}</p> : (
              <ul className="tr-features">
                {analysis.features.map((feature, index) => {
                  const featureTone = sentimentTone(feature.score);
                  const width = Math.abs(feature.score) * 50;
                  return (
                    <li key={`${feature.name}-${index}`}>
                      <button type="button" className="tr-feature-row" aria-expanded={openFeature === index} onClick={() => { setOpenFeature(openFeature === index ? null : index); if (feature.evidence?.verified) select({ kind: "feature", index }); }}>
                        <span className="tr-feature-name">{feature.name}{feature.importance === "must_have" && <em>{t.importance_must_have}</em>}{feature.importance === "nice_to_have" && <em className="soft">{t.importance_nice_to_have}</em>}</span>
                        <span className="tr-bar" aria-hidden="true"><span className="tr-bar-mid" /><i className={`tone-${featureTone}`} style={{ width: `${width}%`, left: feature.score >= 0 ? "50%" : `${50 - width}%` }} /></span>
                        <span className={`tr-stance tone-${featureTone}`}>{text(`stance_${feature.stance}`)} <b>{signed(feature.score)}</b></span>
                      </button>
                      {openFeature === index && feature.evidence && <blockquote className={feature.evidence.verified ? "" : "tr-unverified"} lang={quoteLang}>
                        “{feature.evidence.text}”{!feature.evidence.verified && <small>{t.trUnverified}</small>}</blockquote>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {mapItems.length > 0 && (
            <section className="tr-card tr-wide" aria-labelledby="tr-map-title">
              <h3 id="tr-map-title">{t.trMapTitle}</h3>
              <p className="tr-fine">{t.trMapSub}</p>
              <div className="tr-map">
                <div className="tr-map-line" />
                {mapItems.map((item, order) => (
                  <button key={`${item.kind}-${item.index}`} type="button" aria-label={`${item.label}`} title={item.label}
                    className={`tr-dot tr-dot-${item.kind} tone-${item.tone}${picked?.kind === item.kind && picked.index === item.index ? " selected" : ""}`}
                    style={{ left: `${(item.evidence!.pos ?? 0) * 100}%`, top: `${14 + (order % 3) * 22}px` }}
                    onClick={() => select({ kind: item.kind, index: item.index }, true)} />
                ))}
                <span className="tr-map-end tr-map-start">{t.trMapStart}</span><span className="tr-map-end tr-map-finish">{t.trMapEnd}</span>
              </div>
              <p className="tr-legend"><span className="tr-key tr-key-dot" />{t.trMapFeature}<span className="tr-key tr-key-diamond" />{t.trMapMention}</p>
              {pickedDetail && pickedDetail.evidence && <div className="tr-picked" aria-live="polite"><b>{pickedDetail.title}</b>{pickedDetail.body && <span> — {pickedDetail.body}</span>}
                <blockquote lang={quoteLang}>“{pickedDetail.evidence.text}”</blockquote></div>}
            </section>
          )}

          <section className="tr-card tr-wide" aria-labelledby="tr-mentions-title">
            <h3 id="tr-mentions-title">{t.trMentionsTitle}</h3>
            {analysis.mentions.length === 0 ? <p className="tr-empty">{t.trMentionsEmpty}</p> : <>
              <div className="tr-filters no-print" role="group" aria-label={t.trMentionsTitle}>
                <button type="button" className={mentionFilter === "all" ? "on" : ""} onClick={() => setMentionFilter("all")}>{t.trMentionsAll} <b>{analysis.mentions.length}</b></button>
                {mentionTypes.map((type) => <button key={type} type="button" className={mentionFilter === type ? "on" : ""} onClick={() => setMentionFilter(type)}>{text(`mention_${type}`)} <b>{analysis.mentions.filter((mention) => mention.type === type).length}</b></button>)}
              </div>
              <ul className="tr-mentions">
                {shownMentions.map(({ mention, index }) => (
                  <li key={index} className={`mention-${mention.type}`}>
                    <span className="tr-type">{text(`mention_${mention.type}`)}</span>
                    <p>{mention.text}</p>
                    {mention.evidence && <blockquote className={mention.evidence.verified ? "" : "tr-unverified"} lang={quoteLang}>“{mention.evidence.text}”
                      {mention.evidence.verified ? <button type="button" className="tr-jump no-print" onClick={() => select({ kind: "mention", index }, true)}>{t.trJump}</button> : <small>{t.trUnverified}</small>}</blockquote>}
                  </li>
                ))}
              </ul>
            </>}
            {analysis.alternatives.length > 0 && <p className="tr-alt"><b>{t.trAlternatives}:</b> {analysis.alternatives.join(", ")}</p>}
          </section>
        </>}

        <section className="tr-card tr-wide" aria-labelledby="tr-transcript-title">
          <h3 id="tr-transcript-title">{analysis ? t.trTranscriptMarked : t.transcript}</h3>
          {turns && <p className="tr-fine">{format(t.trTalkShare, { pct: customerShare })}</p>}
          {turns ? (
            <div className="tr-transcript tr-dialogue" lang={quoteLang}>
              {turns.map((turn, index) => <p key={index} className={`tr-turn tr-turn-${turn.who}`}><b className="tr-speaker">{turn.who === "C" ? t.trSpeakerCustomer : t.trSpeakerInterviewer}</b>{partsIn(turn.s, turn.e).map(renderPart)}</p>)}
            </div>
          ) : (
            <p className="tr-transcript" lang={quoteLang}>{segments.map((part, index) => renderPart(part, index))}</p>
          )}
        </section>

        {analysis && <footer className="tr-meta">
          <p>{format(t.trMeta, { asr: asrName || "—", llm: analysis.meta.llmModel ?? "—", duration: durationText || "—", words: analysis.meta.wordCount ?? 0 })}</p>
          {analysis.meta.warnings && analysis.meta.warnings.length > 0 && <details><summary>{t.trWarnings}</summary><ul>{analysis.meta.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        </footer>}
      </section>
    </div>
  );
}
