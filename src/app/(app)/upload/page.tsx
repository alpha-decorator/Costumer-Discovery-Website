"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorker, OEM } from "tesseract.js";
import { AppShell } from "@/components/AppShell";
import { EngineUploader } from "@/components/EngineUploader";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/components/I18nProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { tierWeight, type Customer, type Tier } from "@/lib/customers";
import { getEngineHealth, type EngineHealth, type EngineLanguage } from "@/lib/engine-client";
import { format } from "@/lib/i18n";
import { analyzeNotesWithRules } from "@/lib/nlp-analysis";

type Language = Customer["language"];
type AudioLanguageChoice = "auto" | "english" | "hindi";
type UploadDraft = { name: string; company: string; tier: Tier | "" };
const BLANK_DRAFT: UploadDraft = { name: "", company: "", tier: "" };
// Audio upload is paused for now. Set to true to bring the audio tab back (the engine code stays in place).
const AUDIO_INPUT_ENABLED = false;

/** Adds customer notes: typed or pasted text, a .txt transcript, photos of notes (read in the browser) or, when enabled, audio. */
export default function UploadPage() {
  const { lang: language, t } = useI18n();
  const router = useRouter();
  const { uploaded, upsertRecord, setSelectedIds } = useWorkspace();
  const tRef = useRef(t);
  const langRef = useRef(language);
  const L = (en: string, hi: string) => language === "hi" ? hi : en;
  const [targetRecordId, setTargetRecordId] = useState<string | null>(null);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>(BLANK_DRAFT);
  const [noteMode, setNoteMode] = useState<"audio" | "images" | "text">("text");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [textNotes, setTextNotes] = useState("");
  const [noteProgress, setNoteProgress] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBytes, setAudioBytes] = useState<ArrayBuffer | null>(null);
  const [readingAudio, setReadingAudio] = useState(false);
  const [audioPreview, setAudioPreview] = useState("");
  const [audioLanguage, setAudioLanguage] = useState<AudioLanguageChoice>("auto");
  const [audioStatus, setAudioStatus] = useState<"idle" | "processing" | "complete" | "error">("idle");
  const [audioError, setAudioError] = useState("");
  const [modelProgress, setModelProgress] = useState<{ file: string; progress: number; stage: string } | null>(null);
  const [slowModelLoad, setSlowModelLoad] = useState(false);
  const [engineHealth, setEngineHealth] = useState<EngineHealth | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineDone, setEngineDone] = useState(0);
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const ocrWorkerRef = useRef<Awaited<ReturnType<typeof createWorker>> | null>(null);
  const ocrCancelledRef = useRef(false);
  const pendingUploadRef = useRef<{ id: string; draft: UploadDraft; audioName: string; persisted: boolean; lastRecord?: Customer } | null>(null);
  const cancelTranscriptionRef = useRef<() => void>(() => {});

  useEffect(() => { tRef.current = t; langRef.current = language; }, [t, language]);

  // A "Re-transcribe" or "Replace" link from the customer page opens this page for one saved interview.
  useEffect(() => {
    const replace = new URLSearchParams(window.location.search).get("replace");
    if (replace) setTargetRecordId(replace);
  }, []);
  useEffect(() => {
    const existing = targetRecordId ? uploaded.find((record) => record.id === targetRecordId) : undefined;
    if (existing) setUploadDraft((draft) => draft.name || draft.tier ? draft : { name: existing.name, company: existing.company, tier: existing.tier });
  }, [targetRecordId, uploaded]);

  useEffect(() => {
    if (!AUDIO_INPUT_ENABLED) return;
    let stopped = false;
    const check = async () => { const health = await getEngineHealth(); if (!stopped) setEngineHealth(health); };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const attachWorker = () => {
      const worker = new Worker(new URL("../../transcription.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.addEventListener("message", async (event: MessageEvent<Record<string, unknown>>) => {
        const message = event.data;
        if (message.type === "progress") {
          setModelProgress({ file: String(message.file ?? ""), progress: Number(message.progress ?? 0), stage: String(message.stage ?? "transcription-model") });
        } else if (message.type === "transcription-started") {
          setSlowModelLoad(false);
          setModelProgress({ file: tRef.current.startingAudio, progress: 0, stage: "transcription" });
        } else if (message.type === "transcription-progress") {
          setModelProgress({ file: `${message.processedSeconds ?? 0}s / ${message.totalSeconds ?? 0}s`, progress: Number(message.progress ?? 0), stage: "transcription" });
        } else if (message.type === "analysis-progress") {
          setModelProgress({ file: "", progress: Number(message.progress ?? 0), stage: "analysis" });
        } else if (message.type === "error") {
          setAudioStatus("error");
          setAudioError(String(message.message ?? tRef.current.uploadError));
          setModelProgress(null);
        } else if (message.type === "partial-complete" || message.type === "complete") {
          const pending = pendingUploadRef.current;
          if (!pending) return;
          const { draft } = pending;
          const transcript = String(message.transcript ?? "");
          const isFinal = message.type === "complete";
          let sentiment = Number(message.sentiment ?? 0);
          let topics = message.topics as Customer["topics"];
          let keyPoints = Array.isArray(message.keyPoints) && message.keyPoints.length ? message.keyPoints.map(String) : [transcript];
          let analysisEngine: Customer["analysisEngine"] = "trata-rules";
          let trataAnalysis: Customer["analysis"];
          if (isFinal && transcript.trim()) {
            // The call is read with the built-in rules (no model to download, no server): it takes a fraction of a second.
            setModelProgress({ file: tRef.current.preparingSentiment, progress: 0, stage: "analysis" });
            const read = analyzeNotesWithRules(transcript, { lang: langRef.current, meta: { asrEngine: "browser-whisper", asrModel: "whisper (in this browser)", warnings: [] } });
            sentiment = read.sentiment;
            topics = read.topics;
            keyPoints = read.keyPoints;
            analysisEngine = read.analysisEngine;
            trataAnalysis = read.analysis;
          }
          const newRecord: Customer = {
            id: pending.id,
            name: draft.name.trim() || pending.audioName.replace(/\.[^.]+$/, "") || tRef.current.defaultCustomerName,
            initials: (draft.name.trim() || pending.audioName || "NC").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
            company: draft.company.trim() || "Independent",
            tier: draft.tier as Tier,
            date: new Intl.DateTimeFormat(langRef.current === "hi" ? "hi-IN" : "en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date()),
            sentiment,
            transcript,
            language: message.language === "hi" || message.language === "mixed" ? message.language : "en",
            topics,
            keyPoints,
            audioName: pending.audioName,
            sourceType: "audio",
            analysisEngine,
            transcriptionStatus: isFinal ? "complete" : "processing",
            ...(trataAnalysis ? { analysis: trataAnalysis } : {}),
          };
          setModelProgress({ file: "", progress: 100, stage: "saving" });
          const saveUrl = pending.persisted ? `/api/interviews/${encodeURIComponent(newRecord.id)}` : "/api/interviews";
          void fetch(saveUrl, { method: pending.persisted ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newRecord) })
            .then(async (response) => {
              const saved = await response.json();
              if (!response.ok) throw new Error(saved.error || tRef.current.errSaveInterview);
              pending.persisted = true;
              pending.lastRecord = saved as Customer;
              upsertRecord(saved as Customer);
              setSelectedIds([newRecord.id]);
              if (isFinal) { setAudioStatus("complete"); setModelProgress(null); }
              else setModelProgress({ file: tRef.current.firstPassSaved, progress: Number(message.progress ?? 0), stage: "transcription" });
            })
            .catch((error: unknown) => {
              setAudioStatus("error");
              const detail = error instanceof Error ? error.message : "";
              setAudioError(/failed to fetch|network/i.test(detail) ? tRef.current.errReachDb : detail || tRef.current.errSaveInterview);
              setModelProgress(null);
            });
        }
      });
      worker.addEventListener("error", (event) => {
        setAudioStatus("error");
        setAudioError(event.message || tRef.current.uploadError);
      });
      return worker;
    };
    attachWorker();
    cancelTranscriptionRef.current = () => {
      ocrCancelledRef.current = true;
      const pending = pendingUploadRef.current;
      if (pending?.persisted && pending.lastRecord) {
        const interrupted = { ...pending.lastRecord, transcriptionStatus: "interrupted" as const };
        void fetch(`/api/interviews/${encodeURIComponent(interrupted.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(interrupted) })
          .then((response) => { if (response.ok) upsertRecord(interrupted); })
          .catch(() => {});
      }
      workerRef.current?.terminate();
      void ocrWorkerRef.current?.terminate();
      ocrWorkerRef.current = null;
      attachWorker();
      pendingUploadRef.current = null;
      setAudioStatus("idle");
      setAudioError("");
      setModelProgress(null);
    };
    return () => { workerRef.current?.terminate(); workerRef.current = null; void ocrWorkerRef.current?.terminate(); ocrWorkerRef.current = null; cancelTranscriptionRef.current = () => {}; };
  }, [upsertRecord, setSelectedIds]);

  useEffect(() => {
    setSlowModelLoad(false);
    if (audioStatus !== "processing" || modelProgress?.stage !== "transcription-model" || modelProgress.progress > 0) return;
    const timer = window.setTimeout(() => setSlowModelLoad(true), 15000);
    return () => window.clearTimeout(timer);
  }, [audioStatus, modelProgress]);

  useEffect(() => {
    if (!audioFile) { setAudioPreview(""); return; }
    const url = URL.createObjectURL(audioFile);
    setAudioPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  useEffect(() => {
    const previews = imageFiles.map((file) => URL.createObjectURL(file));
    setImagePreviews(previews);
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [imageFiles]);

  // A plain-text transcript goes into the notes box, where the rules read it like anything typed or pasted.
  const readTranscriptFile = async (file?: File) => {
    if (!file || !/\.txt$/i.test(file.name)) return;
    setTextNotes((await file.text()).slice(0, 20000));
  };

  const selectAudioFile = (file?: File) => {
    if (!file) return;
    setAudioError("");
    setAudioBytes(null);
    if (file.size > 100 * 1024 * 1024) { setAudioFile(null); setAudioStatus("error"); setAudioError(t.fileLimit); return; }
    setAudioFile(file);
    setAudioStatus("idle");
    setModelProgress(null);
    setReadingAudio(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        setAudioStatus("error"); setAudioError(t.errAudioRead);
      } else setAudioBytes(reader.result.slice(0));
      setReadingAudio(false);
    };
    reader.onerror = () => {
      setAudioStatus("error");
      setAudioError(reader.error?.message || t.errAudioRead);
      setReadingAudio(false);
    };
    reader.onabort = () => { setAudioStatus("error"); setAudioError(t.errAudioInterrupted); setReadingAudio(false); };
    reader.readAsArrayBuffer(file);
  };

  const processAudio = async () => {
    if (!audioFile || !audioBytes || !workerRef.current) return;
    if (!targetRecordId && !uploadDraft.tier) { setAudioStatus("error"); setAudioError(t.upTierNone); return; }
    setAudioStatus("processing");
    setAudioError("");
    setModelProgress(null);
    const existing = targetRecordId ? uploaded.find((record) => record.id === targetRecordId) : undefined;
    pendingUploadRef.current = { id: targetRecordId || `CD-${Date.now()}`, draft: existing ? { name: existing.name, company: existing.company, tier: existing.tier } : uploadDraft, audioName: audioFile.name, persisted: Boolean(existing), lastRecord: existing };
    try {
      const audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(audioBytes.slice(0));
      const targetRate = 16000;
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const resampled = await offline.startRendering();
      await audioContext.close();
      const audio = resampled.getChannelData(0).slice();
      workerRef.current.postMessage({ type: "transcribe", audio, language: audioLanguage }, [audio.buffer]);
    } catch (error) {
      setAudioStatus("error");
      setAudioError(error instanceof Error ? format(t.errAudioDecode, { message: error.message }) : t.uploadError);
    }
  };

  const addImages = (files: FileList | File[]) => {
    const picked = Array.from(files);
    if (picked.some((file) => !file.type.startsWith("image/"))) { setAudioError(t.errImagesOnly); return; }
    if (picked.some((file) => file.size > 12 * 1024 * 1024)) { setAudioError(t.errImageSize); return; }
    setImageFiles((current) => {
      const combined = [...current, ...picked].slice(0, 8);
      if (current.length + picked.length > 8) setAudioError(t.errImageCount);
      else setAudioError("");
      return combined;
    });
  };

  const saveNotes = async (transcript: string, sourceType: "images" | "text", imageNames: string[] = []) => {
    const cleaned = transcript.trim();
    if (!cleaned) throw new Error(t.errNoText);
    const existingTier = targetRecordId ? uploaded.find((record) => record.id === targetRecordId)?.tier : undefined;
    const tier = uploadDraft.tier || existingTier;
    if (!tier) throw new Error(t.upTierNone);
    setNoteProgress(t.preparingReport);
    const existing = targetRecordId ? uploaded.find((record) => record.id === targetRecordId) : undefined;
    const id = existing?.id ?? `CD-${Date.now()}`;
    const fallbackName = sourceType === "images" ? imageNames[0]?.replace(/\.[^.]+$/, "") : t.defaultNotesName;
    const displayName = uploadDraft.name.trim() || fallbackName || t.defaultNotesName;
    const savedDate = new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date());
    const company = uploadDraft.company.trim() || "Independent";
    // Typed or pasted notes (and text read from photos) are read by the built-in rules right here: nothing to install, nothing to wait for.
    const read = analyzeNotesWithRules(cleaned, { lang: language === "hi" ? "hi" : "en", meta: { asrEngine: sourceType === "images" ? "ocr" : "text", asrModel: "", warnings: [] } });
    const record: Customer = {
      id, name: displayName, initials: displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase(),
      company, tier, date: savedDate,
      sentiment: read.sentiment, transcript: cleaned, language: read.language as Language, topics: read.topics,
      keyPoints: read.keyPoints, analysisEngine: read.analysisEngine, sourceType, imageNames, audioName: sourceType === "images" ? imageNames.join(", ") : undefined, transcriptionStatus: "complete",
      analysis: read.analysis,
    };
    const response = await fetch(existing ? `/api/interviews/${encodeURIComponent(id)}` : "/api/interviews", {
      method: existing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${body.error || t.errSaveNotes}${body.detail ? ` (${body.detail})` : ""}`);
    const saved = body as Customer;
    upsertRecord(saved);
    setSelectedIds([saved.id]);
    setAudioStatus("complete");
    setNoteProgress("");
  };

  const processNotes = async () => {
    if (noteMode === "audio") { await processAudio(); return; }
    ocrCancelledRef.current = false;
    setAudioStatus("processing"); setAudioError("");
    try {
      if (noteMode === "text") {
        await saveNotes(textNotes, "text");
        return;
      }
      if (!imageFiles.length) throw new Error(t.errAddImage);
      const extracted: string[] = [];
      const ocrWorker = await createWorker("eng+hin", OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js", corePath: "/ocr/tesseract-core-simd-lstm.wasm.js", langPath: "/ocr/lang/", gzip: true,
        cachePath: "fieldnotes-ocr", cacheMethod: "write", workerBlobURL: false,
        logger: (message) => setNoteProgress(format(t.ocrReadingImage, { status: message.status, pct: Math.round(message.progress * 100) })),
      });
      ocrWorkerRef.current = ocrWorker;
      for (let index = 0; index < imageFiles.length; index++) {
        setNoteProgress(format(t.ocrImageOf, { i: index + 1, n: imageFiles.length }));
        const result = await ocrWorker.recognize(imageFiles[index]);
        if (ocrCancelledRef.current) return;
        if (result.data.text.trim()) extracted.push(result.data.text.trim());
      }
      await ocrWorker.terminate(); ocrWorkerRef.current = null;
      if (!extracted.length) throw new Error(t.errNoOcrText);
      await saveNotes(extracted.join("\n\n"), "images", imageFiles.map((file) => file.name));
    } catch (error) {
      await ocrWorkerRef.current?.terminate().catch(() => {}); ocrWorkerRef.current = null;
      if (ocrCancelledRef.current) { setAudioStatus("idle"); return; }
      setAudioStatus("error"); setNoteProgress("");
      setAudioError(error instanceof Error ? error.message : t.errReadNotes);
    }
  };

  const resetForm = () => {
    setAudioFile(null); setAudioBytes(null); setImageFiles([]); setTextNotes(""); setNoteMode("text");
    setAudioStatus("idle"); setAudioError(""); setTargetRecordId(null); setUploadDraft(BLANK_DRAFT); setEngineDone(0);
  };

  const tierName = (tier: Tier) => tier === "Expert" ? t.tierExpert : tier === "Public" ? t.tierPublic : t.tierNewbie;
  const tierOk = Boolean(uploadDraft.tier);
  const engineMode = noteMode === "audio" && AUDIO_INPUT_ENABLED && Boolean(engineHealth?.online);
  const detailsLocked = audioStatus === "processing" || engineBusy;
  const engineLanguage: EngineLanguage = audioLanguage === "hindi" ? "hi" : audioLanguage === "english" ? "en" : "auto";
  const cancelRunning = () => { if (audioStatus === "processing") cancelTranscriptionRef.current(); };
  const complete = audioStatus === "complete";

  return <AppShell title={targetRecordId ? t.replaceNotesTitle : t.addNotes} intro={t.modalIntro} fab={false}>
    {complete ? <section className="fn-card fn-complete">
      <div className="upload-complete">
        <span className="complete-check">✓</span>
        <strong>{t.notesSaved}</strong>
        <p>{t.notesSavedSub}</p>
        <div className="upload-actions">
          <button className="button-secondary" onClick={resetForm}>{L("Add another", "एक और जोड़ें")}</button>
          <button className="button-primary" onClick={() => router.push("/customers")}>{t.uploadDone}</button>
        </div>
      </div>
    </section> : <div className="fn-upload">
      <section className="fn-card" aria-labelledby="up-details">
        <div className="upload-modal-icon"><Icon name="mic" size={20} /></div>
        <span className="eyebrow">{t.customerNotesCaps}</span>
        <h3 id="up-details">{t.upStepDetails}</h3>
        <div className="upload-form-grid">
          <label><span>{t.fullName}</span><input value={uploadDraft.name} onChange={(event) => setUploadDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder={t.phName} maxLength={80} disabled={detailsLocked} /></label>
          <label><span>{t.companyLabel}</span><input value={uploadDraft.company} onChange={(event) => setUploadDraft((draft) => ({ ...draft, company: event.target.value }))} placeholder={t.phCompany} maxLength={120} disabled={detailsLocked} /><small>{t.upCompanyHelp}</small></label>
        </div>
        <fieldset className="tier-choice" disabled={detailsLocked}>
          <legend>{t.customerTier}</legend>
          <div className="tier-options">
            {(["Newbie", "Public", "Expert"] as const).map((value) => <label key={value} className={`tier-option${uploadDraft.tier === value ? " on" : ""}`}><input type="radio" name="customer-tier" value={value} checked={uploadDraft.tier === value} onChange={() => setUploadDraft((draft) => ({ ...draft, tier: value }))} /><strong>{tierName(value)}</strong><small>{format(t.sgWeight, { w: tierWeight(value) })}</small></label>)}
          </div>
          <p className="tier-help">{t.upTierHelp}</p>
        </fieldset>
        {noteMode === "audio" && <div className="upload-form-grid"><label><span>{t.audioLanguage}</span><select value={audioLanguage} onChange={(event) => setAudioLanguage(event.target.value as AudioLanguageChoice)} disabled={detailsLocked || !AUDIO_INPUT_ENABLED}><option value="auto">{t.autoDetect}</option><option value="english">{t.english}</option><option value="hindi">{t.hindi}</option></select></label></div>}
      </section>

      <section className="fn-card" aria-labelledby="up-files">
        <h3 id="up-files">{t.upStepFiles}</h3>
        <div className="note-mode-picker" role="tablist" aria-label={t.modePickerAria}>
          <button type="button" role="tab" aria-selected={noteMode === "audio"} className={noteMode === "audio" ? "selected" : ""} onClick={() => setNoteMode("audio")}>{t.modeAudio}<small>{AUDIO_INPUT_ENABLED ? t.modeAudioSub : t.audioComingSoon}</small></button>
          <button type="button" role="tab" aria-selected={noteMode === "images"} className={noteMode === "images" ? "selected" : ""} onClick={() => setNoteMode("images")}>{t.modeImages}<small>{t.modeImagesSub}</small></button>
          <button type="button" role="tab" aria-selected={noteMode === "text"} className={noteMode === "text" ? "selected" : ""} onClick={() => setNoteMode("text")}>{t.modeText}<small>{t.modeTextSub}</small></button>
        </div>
        {noteMode === "audio" && (AUDIO_INPUT_ENABLED && engineHealth?.online ? <EngineUploader
          health={engineHealth} tier={uploadDraft.tier} canStart={tierOk} actionsHost={actionsHost} onDoneChange={setEngineDone} company={uploadDraft.company} singleName={uploadDraft.name} language={engineLanguage}
          existingAudioNames={uploaded.filter((record) => record.id !== targetRecordId).map((record) => record.audioName).filter((name): name is string => Boolean(name))}
          today={new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date())}
          replaceId={targetRecordId ?? undefined} onBusyChange={setEngineBusy}
          onSaved={(saved) => { upsertRecord(saved as Customer); setSelectedIds([saved.id]); }} /> : <>
          {AUDIO_INPUT_ENABLED && engineHealth && <div className="engine-box"><p className="engine-status engine-bad" role="status"><i aria-hidden="true" />{t.engineOffline}</p></div>}
          <label className="audio-dropzone" htmlFor="audio-input" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectAudioFile(event.dataTransfer.files[0]); }}><span className="dropzone-icon"><Icon name="arrow" size={17} /></span><strong>{audioFile ? audioFile.name : t.chooseFile}</strong><span>{audioFile ? `${(audioFile.size / (1024 * 1024)).toFixed(1)} MB` : t.audioFormats}</span><input id="audio-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" onChange={(event) => selectAudioFile(event.target.files?.[0])} disabled={audioStatus === "processing" || !AUDIO_INPUT_ENABLED} /></label>
          {readingAudio && <p role="status">{t.readingAudio}</p>}{audioFile && audioPreview && <audio className="audio-preview" controls src={audioPreview} />}
          <div className="notes-audio-hint">{AUDIO_INPUT_ENABLED ? t.audioHint : t.audioComingSoonHint}</div>
        </>)}
        {noteMode === "images" && <>
          <label className="audio-dropzone image-dropzone" htmlFor="image-input" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addImages(event.dataTransfer.files); }}><span className="dropzone-icon">▧</span><strong>{t.chooseImages}</strong><span>{t.imageFormats}</span><input id="image-input" type="file" accept="image/*" capture="environment" multiple onChange={(event) => { if (event.target.files) addImages(event.target.files); event.target.value = ""; }} disabled={audioStatus === "processing"} /></label>
          {imageFiles.length > 0 && <div className="image-preview-grid">{imageFiles.map((file, index) => <div className="image-preview-item" key={`${file.name}-${index}`}><img src={imagePreviews[index]} alt={format(t.noteImageAlt, { n: index + 1 })} /><span title={file.name}>{file.name}</span><button type="button" aria-label={format(t.removeAria, { name: file.name })} onClick={() => setImageFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button></div>)}</div>}
          <div className="notes-audio-hint">{t.imageHint}</div>
        </>}
        {noteMode === "text" && <>
          <label className="audio-dropzone" htmlFor="transcript-input" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); readTranscriptFile(event.dataTransfer.files[0]); }}><span className="dropzone-icon"><Icon name="arrow" size={17} /></span><strong>{t.chooseTranscript}</strong><span>{t.transcriptFormats}</span><input id="transcript-input" type="file" accept=".txt,text/plain" onChange={(event) => { readTranscriptFile(event.target.files?.[0]); event.target.value = ""; }} disabled={audioStatus === "processing"} /></label>
          <label className="written-notes-label"><span>{t.notesLabel}</span><textarea rows={8} maxLength={20000} value={textNotes} onChange={(event) => setTextNotes(event.target.value)} placeholder={t.notesPlaceholder} disabled={audioStatus === "processing"} /><small>{format(t.notesCount, { n: textNotes.length.toLocaleString() })}</small></label>
        </>}

        {audioStatus === "processing" && <div className="processing-panel" role="status"><span className="spinner" /><span>{noteMode === "audio" ? (modelProgress?.stage === "transcription" ? format(t.transcribingAudio, { file: modelProgress.file, pct: Math.round(modelProgress.progress) }) : modelProgress?.stage === "saving" ? t.savingInterview : modelProgress?.stage === "analysis" ? modelProgress.file : t.processing) : noteProgress || (noteMode === "images" ? t.preparingOcr : t.analyzingNotes)}</span>{noteMode === "audio" && modelProgress?.stage === "transcription" && <progress max="100" value={modelProgress.progress} />}</div>}
        {slowModelLoad && noteMode === "audio" && audioStatus === "processing" && <p className="upload-error" role="status">{t.slowModel}</p>}
        {audioStatus === "error" && <p className="upload-error" role="alert">{audioError || t.uploadError}</p>}
        <div className="upload-actions">
          {!tierOk && <span className="upload-hint" role="status">{t.upTierNone}</span>}
          <button className="button-secondary" onClick={() => { if (audioStatus === "processing") cancelRunning(); else router.push("/customers"); }}>{audioStatus === "processing" ? t.cancelProcessing : engineMode && engineDone > 0 && !engineBusy ? t.close : t.cancel}</button>
          {engineMode ? <span className="upload-actions-host" ref={setActionsHost} /> : <button className="button-primary" onClick={processNotes} disabled={!tierOk || audioStatus === "processing" || (noteMode === "audio" && !AUDIO_INPUT_ENABLED) || (noteMode === "audio" ? !audioFile || !audioBytes || readingAudio : noteMode === "images" ? !imageFiles.length : !textNotes.trim())}><Icon name="spark" size={15} />{audioStatus === "processing" ? t.working : noteMode === "audio" ? t.transcribe : t.analyzeSave}</button>}
        </div>
      </section>
    </div>}
  </AppShell>;
}
