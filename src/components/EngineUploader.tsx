"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import { EngineError, cancelJob, nameFromFile, recordFromResult, startAudioJob, waitForJob, type EngineHealth, type EngineLanguage } from "@/lib/engine-client";
import { format } from "@/lib/i18n";
import type { Interview } from "@/lib/interviews";

type Status = "waiting" | "uploading" | "queued" | "processing" | "saving" | "done" | "skipped" | "error" | "cancelled";
type Item = { id: string; file: File; name: string; status: Status; progress: number; stage: string; position: number; error?: string; jobId?: string };

type Props = {
  health: EngineHealth;
  /** "" until the person has chosen a customer type; nothing can be submitted before that. */
  tier: Interview["tier"] | "";
  company: string;
  /** Used as the customer name only when a single file is chosen. */
  singleName: string;
  language: EngineLanguage;
  existingAudioNames: string[];
  today: string;
  /** When set (re-transcribing a saved interview), the single result replaces that record instead of adding a new one. */
  replaceId?: string;
  onSaved: (record: Interview) => void;
  onBusyChange?: (busy: boolean) => void;
  /** How many recordings have been saved so far (lets the dialog turn "Cancel" into "Close"). */
  onDoneChange?: (done: number) => void;
  /** The submit / stop / retry buttons are drawn into this element (the dialog footer) so they sit next to Cancel. `null` means the footer is not ready yet; leave it out to keep the buttons inside the box. */
  actionsHost?: HTMLElement | null;
  /** False while something required (the customer type) is still missing; the submit button stays disabled. */
  canStart?: boolean;
};

const MAX_BYTES = 600 * 1024 * 1024;
const FINISHED: Status[] = ["done", "skipped"];
const newId = () => `CD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** Multi-file queue for the Trata engine. Two files are in flight at once, so the engine always has the next one ready. */
export function EngineUploader({ health, tier, company, singleName, language, existingAudioNames, today, replaceId, onSaved, onBusyChange, onDoneChange, actionsHost, canStart = true }: Props) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useRef<Item[]>([]);
  const stopRef = useRef(false);
  const controllers = useRef(new Map<string, AbortController>());
  const latest = useRef({ tier, company, singleName, language, today, replaceId, onSaved, t, lang });
  latest.current = { tier, company, singleName, language, today, replaceId, onSaved, t, lang };

  const commit = (next: Item[]) => { itemsRef.current = next; setItems(next); };
  const patch = (id: string, changes: Partial<Item>) => commit(itemsRef.current.map((item) => item.id === id ? { ...item, ...changes } : item));

  useEffect(() => { onBusyChange?.(running); }, [running, onBusyChange]);
  const doneCount = items.filter((item) => item.status === "done").length;
  useEffect(() => { onDoneChange?.(doneCount); }, [doneCount, onDoneChange]);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  useEffect(() => () => { stopRef.current = true; controllers.current.forEach((controller) => controller.abort()); onBusyChange?.(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = (list: FileList | File[]) => {
    const known = new Set(itemsRef.current.map((item) => `${item.file.name}|${item.file.size}|${item.file.lastModified}`));
    const added: Item[] = [];
    for (const file of Array.from(list)) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (known.has(key)) continue;
      known.add(key);
      const skipped = existingAudioNames.includes(file.name);
      const tooBig = file.size > MAX_BYTES;
      added.push({ id: newId(), file, name: "", status: skipped ? "skipped" : tooBig ? "error" : "waiting", progress: skipped ? 1 : 0, stage: "", position: 0, error: tooBig ? t.engineFileTooBig : undefined });
    }
    if (added.length) commit([...itemsRef.current, ...added]);
  };

  const processItem = useCallback(async (item: Item) => {
    const now = latest.current;
    if (!now.tier) { patch(item.id, { status: "error", error: now.t.upTierNone }); return; }
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    try {
      patch(item.id, { status: "uploading", progress: 0, error: undefined });
      const started = await startAudioJob(item.file, { language: now.language, signal: controller.signal });
      patch(item.id, { jobId: started.id, status: "processing" });
      const finished = started.status === "done" ? started : await waitForJob(started.id, (job) => {
        patch(item.id, { progress: job.progress, stage: job.stage, position: job.queuePosition, status: job.status === "queued" ? "queued" : "processing" });
      }, { signal: controller.signal });
      patch(item.id, { status: "saving", progress: 1 });
      const many = itemsRef.current.filter((entry) => entry.status !== "skipped").length > 1;
      const typedName = itemsRef.current.find((entry) => entry.id === item.id)?.name.trim();
      const name = typedName || (!many && now.singleName.trim()) || nameFromFile(item.file.name) || latest.current.t.defaultCustomerName;
      patch(item.id, { name });
      const targetId = now.replaceId && !many ? now.replaceId : undefined;
      const record = recordFromResult(finished.result!, { id: targetId ?? newId(), name, company: now.company.trim() || "Independent", tier: now.tier, date: now.today, audioName: item.file.name, sourceType: "audio" }, now.lang);
      const response = await fetch(targetId ? `/api/interviews/${encodeURIComponent(targetId)}` : "/api/interviews", { method: targetId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record) });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const saved = await response.json() as Interview & { error?: string; detail?: string };
      if (!response.ok) throw new Error(`${saved.error || latest.current.t.errSaveInterview}${saved.detail ? ` (${saved.detail})` : ""}`);
      latest.current.onSaved(saved);
      patch(item.id, { status: "done", progress: 1 });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof EngineError && error.code === "cancelled")) { patch(item.id, { status: "cancelled" }); return; }
      const text = error instanceof EngineError && error.code === "engine_offline" ? latest.current.t.engineLost : error instanceof Error ? error.message : latest.current.t.uploadError;
      patch(item.id, { status: "error", error: text });
    } finally {
      controllers.current.delete(item.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    const claimed = new Set<string>();
    const worker = async () => {
      for (;;) {
        if (stopRef.current) return;
        const next = itemsRef.current.find((item) => item.status === "waiting" && !claimed.has(item.id));
        if (!next) return;
        claimed.add(next.id);
        await processItem(next);
      }
    };
    await Promise.all([worker(), worker()]);
    setRunning(false);
  };

  const stop = () => {
    stopRef.current = true;
    controllers.current.forEach((controller) => controller.abort());
    itemsRef.current.forEach((item) => { if (item.jobId && ["queued", "processing"].includes(item.status)) void cancelJob(item.jobId); });
  };

  const rename = (id: string, name: string) => patch(id, { name });
  const retry = () => commit(itemsRef.current.map((item) => item.status === "error" || item.status === "cancelled" ? { ...item, status: "waiting", progress: 0, error: undefined, jobId: undefined } : item));
  const clearFinished = () => commit(itemsRef.current.filter((item) => !FINISHED.includes(item.status)));

  const counts = {
    total: items.length, done: items.filter((item) => item.status === "done").length, skipped: items.filter((item) => item.status === "skipped").length,
    failed: items.filter((item) => item.status === "error" || item.status === "cancelled").length, waiting: items.filter((item) => item.status === "waiting").length,
  };
  const statusText = (item: Item) => {
    const pct = Math.round(item.progress * 100);
    switch (item.status) {
      case "waiting": return t.qWaiting;
      case "uploading": return t.qUploading;
      case "queued": return format(t.qQueued, { pos: item.position });
      case "processing": return item.stage === "analyzing" ? format(t.qAnalyzing, { pct }) : item.stage === "transcribing" ? format(t.qTranscribing, { pct }) : item.stage === "loading" ? t.qLoading : t.qPreparing;
      case "saving": return t.qSaving;
      case "done": return t.qDone;
      case "skipped": return t.qSkipped;
      case "cancelled": return t.qCancelled;
      default: return t.qFailed;
    }
  };

  const ready = health.online && (health.indic || health.whisper);
  const actions = <>
    {running ? <button type="button" className="button-secondary" onClick={stop}>{t.engineStop}</button>
      : <button type="button" className="button-primary" onClick={start} disabled={!ready || !canStart || counts.waiting === 0}>{format(t.engineStart, { n: counts.waiting })}</button>}
    {!running && counts.failed > 0 && <button type="button" className="button-secondary" onClick={retry}>{t.engineRetry}</button>}
    {!running && counts.done + counts.skipped > 0 && <button type="button" className="button-secondary" onClick={clearFinished}>{t.engineClear}</button>}
  </>;
  return (
    <div className="engine-box">
      <p className={`engine-status ${ready ? "engine-ok" : "engine-bad"}`} role="status">
        <i aria-hidden="true" />
        {!health.online ? t.engineOffline : !(health.indic || health.whisper) ? t.engineNoAsr : t.engineOnline}
      </p>
      {health.online && health.whisper && !health.indic && <p className="engine-hint engine-warn">{t.engineWhisperOnly}{health.indicReason ? <> <small>{health.indicReason}</small></> : null}</p>}
      <label className="engine-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
        <input type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.opus,.webm,.wma" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
        <strong>{t.engineDrop}</strong>
        <span>{t.engineDropSub}</span>
      </label>

      {items.length > 0 && <>
        {items.filter((item) => item.status !== "skipped").length > 1 && singleName.trim() && <p className="engine-hint">{t.upNameIgnored}</p>}
        <p className="engine-summary" aria-live="polite">{format(t.engineSummary, { done: counts.done + counts.skipped, total: counts.total, failed: counts.failed })}</p>
        <ul className="engine-list">
          {items.map((item) => (
            <li key={item.id} className={`engine-item engine-${item.status}`}>
              <span className="engine-name" title={item.file.name}>{item.file.name}</span>
              <span className="engine-state">{statusText(item)}</span>
              {item.status !== "skipped" && <input className="engine-name-input" value={item.name} onChange={(event) => rename(item.id, event.target.value)} maxLength={80} placeholder={nameFromFile(item.file.name) || t.defaultCustomerName} aria-label={`${t.upNameFor}: ${item.file.name}`} disabled={!["waiting", "error", "cancelled"].includes(item.status)} />}
              <span className="engine-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}><i style={{ width: `${Math.round(item.progress * 100)}%` }} /></span>
              {item.error && <small className="engine-error">{item.error}</small>}
            </li>
          ))}
        </ul>
      </>}
      {actionsHost === undefined ? <div className="engine-actions">{actions}</div> : actionsHost ? createPortal(actions, actionsHost) : null}
      <p className="engine-hint">{t.engineHint}</p>
    </div>
  );
}
