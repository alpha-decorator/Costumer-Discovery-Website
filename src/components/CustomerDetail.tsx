"use client";

import { useState } from "react";
import { Radar, ScaleBar } from "@/components/Charts";
import { useI18n } from "@/components/I18nProvider";
import { Icon } from "@/components/Icon";
import { TOPICS, initialsColor, signed, summarize, tierColor, type Customer, type Tier } from "@/lib/customers";
import { useWorkspace } from "@/components/WorkspaceProvider";

/**
 * One customer in detail: the score on the -1 to +1 scale, the key points, the transcript, the topic radar against the
 * whole group, and the actions (report, edit, re-transcribe, delete). Editing and deleting go through the workspace.
 */
export function CustomerDetail({ customer, group, onClose, onReport, onPdf, onAskDelete }: { customer: Customer; group: Customer[]; onClose: () => void; onReport: (customer: Customer) => void; onPdf: (customer: Customer) => void; onAskDelete: (customer: Customer) => void }) {
  const { lang, t } = useI18n();
  const { isSaved, saveEdit } = useWorkspace();
  const [editDraft, setEditDraft] = useState<Customer | null>(null);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  const saved = isSaved(customer);
  const topicName = (topic: string) => topic === "UX" ? t.topicUX : topic === "Pricing" ? t.topicPricing : t.topicFeatures;
  const tierName = (tier: Tier) => tier === "Expert" ? t.tierExpert : tier === "Public" ? t.tierPublic : t.tierNewbie;
  const tone = customer.sentiment > 0.15 ? "tone-pos" : customer.sentiment < -0.15 ? "tone-neg" : "tone-neu";
  const groupTopics = summarize(group).topics;

  const submitEdit = async () => {
    if (!editDraft) return;
    setSavingEdit(true); setEditError("");
    try { await saveEdit(editDraft); setEditDraft(null); }
    catch (error) { setEditError(error instanceof Error ? error.message : t.errSaveChanges); }
    finally { setSavingEdit(false); }
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="detail-modal fn-detail" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
      <button className="modal-close icon-button" onClick={onClose} aria-label={t.close}><Icon name="close" size={18} /></button>
      <div className="fn-detail-top">
        <div className="modal-person">
          <span className={`avatar avatar-${initialsColor(customer.name)}`}>{customer.initials}</span>
          <div>
            <span className="eyebrow">{customer.id} · {customer.language === "hi" ? "हिंदी" : customer.language === "mixed" ? t.mixedLanguage : "English"}</span>
            <h2 id="modal-title">{customer.name}</h2>
            <p>{customer.company} · {customer.date}</p>
          </div>
        </div>
        <div className="fn-pills">
          <span className={`tier-pill tier-${customer.tier.toLowerCase()}`}><i />{tierName(customer.tier)}</span>
          <span className={`fn-pill ${tone}`}>{signed(customer.sentiment)}</span>
        </div>
      </div>
      <ScaleBar value={customer.sentiment} />

      {editDraft ? <div className="edit-interview-form">
        <label>{t.fieldName}<input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value, initials: event.target.value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() })} /></label>
        <label>{t.fieldCompany}<input value={editDraft.company} onChange={(event) => setEditDraft({ ...editDraft, company: event.target.value })} /></label>
        <label>{t.fieldTier}<select value={editDraft.tier} onChange={(event) => setEditDraft({ ...editDraft, tier: event.target.value as Tier })}><option value="Newbie">{t.tierNewbie}</option><option value="Public">{t.tierPublic}</option><option value="Expert">{t.tierExpert}</option></select></label>
        <label>{t.fieldSentiment}<input type="number" min="-1" max="1" step="0.01" value={editDraft.sentiment} onChange={(event) => setEditDraft({ ...editDraft, sentiment: Number(event.target.value) })} /></label>
        <label>{t.fieldTopics}<div className="edit-topic-grid">{TOPICS.map((topic) => <label key={topic}>{topicName(topic)}<input type="number" min="-1" max="1" step="0.01" value={editDraft.topics[topic]} onChange={(event) => setEditDraft({ ...editDraft, topics: { ...editDraft.topics, [topic]: Number(event.target.value) } })} /></label>)}</div></label>
        <label>{t.fieldPoints}<textarea rows={4} value={editDraft.keyPoints.join("\n")} onChange={(event) => setEditDraft({ ...editDraft, keyPoints: event.target.value.split("\n").filter(Boolean) })} /></label>
        <label>{t.fieldTranscript}<textarea rows={8} value={editDraft.transcript} onChange={(event) => setEditDraft({ ...editDraft, transcript: event.target.value })} /></label>
        {editError && <p className="upload-error" role="alert">{editError}</p>}
        <div className="upload-actions"><button className="button-secondary" onClick={() => { setEditDraft(null); setEditError(""); }}>{t.cancel}</button><button className="button-primary" onClick={submitEdit} disabled={savingEdit || !editDraft.name.trim() || !editDraft.transcript.trim()}>{savingEdit ? t.saving : t.saveChanges}</button></div>
      </div> : <>
        <div className="fn-detail-grid">
          <section className="fn-detail-col">
            <span className="eyebrow">{t.customerPoints}</span>
            <div className="customer-detail-points">{customer.keyPoints.map((point, index) => <p key={`${index}-${point}`} lang={customer.language === "hi" ? "hi" : "en"}><i />{point}</p>)}</div>
            <div className="transcript-box">
              <span className="eyebrow">{customer.sourceType === "images" ? t.imageNotes : customer.sourceType === "text" ? t.writtenNotes : t.transcript}{customer.audioName ? ` · ${customer.audioName}` : ""}</span>
              <p lang={customer.language === "hi" ? "hi" : "en"}>{customer.transcript}</p>
            </div>
          </section>
          <section className="fn-detail-col">
            <span className="eyebrow">{t.topicHeading}</span>
            <Radar labels={TOPICS.map(topicName)} series={[
              { name: customer.name.split(" ")[0], values: TOPICS.map((topic) => customer.topics[topic]), color: tierColor(customer.tier) },
              { name: L("Group average", "समूह औसत"), values: groupTopics.map((topic) => topic.simple), dashed: true },
            ]} />
          </section>
        </div>
        <div className="upload-actions fn-detail-actions">
          <button className="button-secondary modal-delete" onClick={() => onAskDelete(customer)}>{t.deleteCustomer}</button>
          {saved && <>
            <a className="button-secondary" href={`/upload?replace=${encodeURIComponent(customer.id)}`}>{t.retranscribe}</a>
            <button className="button-secondary" onClick={() => { setEditDraft({ ...customer, topics: { ...customer.topics }, keyPoints: [...customer.keyPoints] }); setEditError(""); }}>{t.editSaved}</button>
          </>}
          {customer.analysis && <button className="button-secondary" onClick={() => onReport(customer)}>{t.trReportOpen}</button>}
          <button className="button-secondary" onClick={() => onPdf(customer)}><Icon name="arrow" size={14} />{L("Report & PDF", "रिपोर्ट और PDF")}</button>
          <button className="button-primary" onClick={onClose}>{t.close}</button>
        </div>
      </>}
    </section>
  </div>;
}
