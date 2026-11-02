"use client";

import { useState } from "react";
import { analyzeNotesWithRules } from "@/lib/nlp-analysis";
import { Radar, ScaleBar } from "@/components/Charts";
import { useI18n } from "@/components/I18nProvider";
import { Icon } from "@/components/Icon";
import { TOPICS, initialsColor, signed, summarize, tierColor, type Customer, type Tier } from "@/lib/customers";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { DemographicsFields } from "@/components/DemographicsFields";
import { CustomerInsightsView } from "@/components/CustomerInsights";
import { AREAS, EDUCATIONS, GENDERS, INCOMES, OCCUPATIONS, VEHICLES, cleanDemographics, optionLabel, stateLabel } from "@/lib/demographics";

/**
 * One customer in detail: the score on the -1 to +1 scale, the key points, the transcript, the topic radar against the
 * whole group, and the actions (report, edit, re-transcribe, delete). Editing and deleting go through the workspace.
 */
export function CustomerDetail({ customer, group, startEditing = false, onClose, onReport, onPdf, onAskDelete }: { customer: Customer; group: Customer[]; startEditing?: boolean; onClose: () => void; onReport: (customer: Customer) => void; onPdf: (customer: Customer) => void; onAskDelete: (customer: Customer) => void }) {
  const { lang, t } = useI18n();
  const { isSaved, saveEdit } = useWorkspace();
  const draftOf = (record: Customer): Customer => ({ ...record, topics: { ...record.topics }, keyPoints: [...record.keyPoints], demographics: { ...record.demographics } });
  const [editDraft, setEditDraft] = useState<Customer | null>(() => startEditing && isSaved(customer) ? draftOf(customer) : null);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  const saved = isSaved(customer);
  const topicName = (topic: string) => topic === "UX" ? t.topicUX : topic === "Pricing" ? t.topicPricing : t.topicFeatures;
  const tierName = (tier: Tier) => tier === "Expert" ? t.tierExpert : tier === "Public" ? t.tierPublic : t.tierNewbie;
  const tone = customer.sentiment > 0.15 ? "tone-pos" : customer.sentiment < -0.15 ? "tone-neg" : "tone-neu";
  const groupTopics = summarize(group).topics;
  const demo = customer.demographics ?? {};
  const profile = ([
    [L("Age", "उम्र"), demo.age !== undefined ? String(demo.age) : ""],
    [L("Gender", "लिंग"), optionLabel(GENDERS, demo.gender, lang)],
    [L("State", "राज्य"), demo.state ? stateLabel(demo.state, lang) : ""],
    [L("Lives in", "रहते हैं"), optionLabel(AREAS, demo.area, lang)],
    [L("Occupation", "पेशा"), optionLabel(OCCUPATIONS, demo.occupation, lang)],
    [L("Income", "आय"), optionLabel(INCOMES, demo.income, lang)],
    [L("Education", "शिक्षा"), optionLabel(EDUCATIONS, demo.education, lang)],
    [L("Travels by", "साधन"), optionLabel(VEHICLES, demo.vehicle, lang)],
  ] as Array<[string, string]>).filter(([, value]) => value);

  const submitEdit = async () => {
    if (!editDraft) return;
    setSavingEdit(true); setEditError("");
    try {
      let record = { ...editDraft, name: editDraft.name.trim(), company: editDraft.company.trim() || "Independent", transcript: editDraft.transcript.trim() };
      if (record.transcript !== customer.transcript.trim()) {
        // The conversation changed, so the score, topics and key points are worked out again by the same rules used at upload.
        const read = analyzeNotesWithRules(record.transcript, { lang: lang === "hi" ? "hi" : "en", meta: { asrEngine: record.sourceType === "images" ? "ocr" : "text", asrModel: "", warnings: [] } });
        record = { ...record, sentiment: read.sentiment, topics: read.topics, keyPoints: read.keyPoints, analysisEngine: read.analysisEngine, analysis: read.analysis, language: read.language as Customer["language"] };
      }
      await saveEdit(record); setEditDraft(null);
    }
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
            <p>{customer.company}{customer.city ? ` · ${customer.city}` : ""} · {customer.date}</p>
          </div>
        </div>
        <div className="fn-pills">
          <span className={`tier-pill tier-${customer.tier.toLowerCase()}`}><i />{tierName(customer.tier)}</span>
          <span className={`fn-pill ${tone}`}>{signed(customer.sentiment)}</span>
        </div>
      </div>
      <ScaleBar value={customer.sentiment} />
      {profile.length > 0 && <dl className="fn-profile-chips">{profile.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}

      {editDraft ? <div className="edit-interview-form">
        <fieldset className="fn-edit-block"><legend>{L("Customer details", "ग्राहक की जानकारी")}</legend>
          <div className="upload-form-grid fn-edit-grid">
            <label><span>{t.fieldName}</span><input value={editDraft.name} maxLength={80} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value, initials: event.target.value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() })} /></label>
            <label><span>{t.fieldCompany}</span><input value={editDraft.company} maxLength={120} onChange={(event) => setEditDraft({ ...editDraft, company: event.target.value })} /></label>
            <label><span>{t.fieldTier}</span><select value={editDraft.tier} onChange={(event) => setEditDraft({ ...editDraft, tier: event.target.value as Tier })}><option value="Newbie">{t.tierNewbie}</option><option value="Public">{t.tierPublic}</option><option value="Expert">{t.tierExpert}</option></select></label>
            <label><span>{L("Interview date", "इंटरव्यू की तारीख़")}</span><input value={editDraft.date} maxLength={40} onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value })} /></label>
          </div>
        </fieldset>
        <fieldset className="fn-profile-edit fn-edit-block"><legend>{L("Location & personal details", "स्थान और निजी जानकारी")}</legend>
          <DemographicsFields value={editDraft.demographics ?? {}} onChange={(demographics) => setEditDraft({ ...editDraft, demographics: cleanDemographics(demographics) })} city={editDraft.city ?? ""} onCityChange={(city) => setEditDraft({ ...editDraft, city: city || undefined })} lang={lang} />
        </fieldset>
        <fieldset className="fn-edit-block"><legend>{L("Conversation", "बातचीत")}</legend>
          <textarea className="fn-edit-conversation" rows={12} maxLength={20000} value={editDraft.transcript} onChange={(event) => setEditDraft({ ...editDraft, transcript: event.target.value })} lang={editDraft.language === "hi" ? "hi" : "en"} aria-label={L("Conversation", "बातचीत")} />
          <p className="fn-edit-note">{editDraft.transcript.trim() !== customer.transcript.trim()
            ? L("The conversation has changed: the score, topics and key points will be worked out again when you save.", "बातचीत बदली है: सेव करने पर स्कोर, विषय और मुख्य बातें फिर से निकाली जाएँगी।")
            : L("Fix wording, add missing lines or remove ones that are not the customer's. Saving re-scores the interview.", "शब्द ठीक करें, छूटी पंक्तियाँ जोड़ें या ग़लत हटाएँ। सेव करने पर इंटरव्यू का स्कोर दोबारा निकलेगा।")}<span>{editDraft.transcript.length.toLocaleString()} / 20,000</span></p>
        </fieldset>
        {editDraft.transcript.trim() === customer.transcript.trim() && <details className="fn-edit-block fn-edit-advanced">
          <summary>{L("Adjust the score by hand", "स्कोर हाथ से बदलें")}</summary>
          <label>{t.fieldSentiment}<input type="number" min="-1" max="1" step="0.01" value={editDraft.sentiment} onChange={(event) => setEditDraft({ ...editDraft, sentiment: Math.max(-1, Math.min(1, Number(event.target.value) || 0)) })} /></label>
          <label>{t.fieldTopics}<div className="edit-topic-grid">{TOPICS.map((topic) => <label key={topic}>{topicName(topic)}<input type="number" min="-1" max="1" step="0.01" value={editDraft.topics[topic]} onChange={(event) => setEditDraft({ ...editDraft, topics: { ...editDraft.topics, [topic]: Math.max(-1, Math.min(1, Number(event.target.value) || 0)) } })} /></label>)}</div></label>
          <label>{t.fieldPoints}<textarea rows={4} value={editDraft.keyPoints.join("\n")} onChange={(event) => setEditDraft({ ...editDraft, keyPoints: event.target.value.split("\n").filter(Boolean) })} /></label>
        </details>}
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
        {customer.analysis && <section className="fn-detail-insights">
          <span className="eyebrow">{L("What we learned from this call", "इस बातचीत से क्या पता चला")}</span>
          <CustomerInsightsView analysis={customer.analysis} lang={customer.language === "hi" ? "hi" : "en"} />
        </section>}
        <div className="upload-actions fn-detail-actions">
          <button className="button-secondary modal-delete" onClick={() => onAskDelete(customer)}>{t.deleteCustomer}</button>
          {saved && <>
            <a className="button-secondary" href={`/upload?replace=${encodeURIComponent(customer.id)}`}>{t.retranscribe}</a>
            <button className="button-secondary" onClick={() => { setEditDraft(draftOf(customer)); setEditError(""); }}><Icon name="pencil" size={14} />{L("Edit details & conversation", "जानकारी और बातचीत बदलें")}</button>
          </>}
          {customer.analysis && <button className="button-secondary" onClick={() => onReport(customer)}>{t.trReportOpen}</button>}
          <button className="button-secondary" onClick={() => onPdf(customer)}><Icon name="arrow" size={14} />{L("Report & PDF", "रिपोर्ट और PDF")}</button>
          <button className="button-primary" onClick={onClose}>{t.close}</button>
        </div>
      </>}
    </section>
  </div>;
}
