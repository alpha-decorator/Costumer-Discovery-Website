"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { format, type DictKey } from "@/lib/i18n";
import { normalizeCode } from "@/lib/org-code";
import { clearOrgNotice, peekOrgNotice, setOrgNotice, type OrgNotice } from "@/lib/org-notice";
import type { OrgView } from "@/lib/org-view";

type Reply = { ok: boolean; status: number; data: Partial<OrgView> & { error?: string } };

async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  try {
    const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as Reply["data"];
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
}

/**
 * The "Business code" screen. Without an organization it offers to create one (a generated or a chosen code) or to join a colleague's;
 * with one it shows the code to copy, which workspace is open, and, for the owner, ways to change the code and remove people.
 * `onWorkspaceChanged` runs after the open workspace changes (create, join, switch, leave), because the session cookie has changed and
 * the page has to load the other set of interviews.
 */
export function OrgPanel({ onWorkspaceChanged, onViewChange }: { onWorkspaceChanged: () => void; onViewChange?: (view: OrgView) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<OrgView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadStatus, setLoadStatus] = useState(0);
  const [busy, setBusy] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  /** Problems found before anything is sent (an empty or badly spelled code); shown in the same place as server errors. */
  const [localError, setLocalError] = useState<DictKey | "">("");
  /** Which form the message belongs to, so it appears right under the button that was pressed. */
  const [errorWhere, setErrorWhere] = useState("");
  const [copied, setCopied] = useState(false);
  /** What just happened before the page reloaded (code created, joined…); read once from the reload hand-over. */
  const [notice, setNotice] = useState<OrgNotice | null>(() => peekOrgNotice());

  const [name, setName] = useState("");
  const [choice, setChoice] = useState<"generate" | "own">("generate");
  const [own, setOwn] = useState("");
  const [share, setShare] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const codeBox = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const reply = await call("GET", "/api/org");
    if (reply.ok) { setView(reply.data as OrgView); setLoadFailed(false); } else { setLoadFailed(true); setLoadStatus(reply.status); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { clearOrgNotice(); }, []);
  useEffect(() => { if (view) onViewChange?.(view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view?.org) setNewName(view.org.name); }, [view?.org?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // "invalid_code" with status 404 means the code is well formed but nobody has it; with 400 it is badly spelled.
  const errorKey = errorCode === "invalid_code" && errorStatus === 404 ? "code_not_found" : errorCode;
  const serverMessage = errorKey ? (t[`orgErr_${errorKey}` as DictKey] ?? t.orgErr_server_error) : "";
  const message = localError ? t[localError] : serverMessage && (errorKey === "server_error" || errorKey === "network") && errorStatus
    ? format(t.orgErrWithStatus, { message: serverMessage, status: errorStatus }) : serverMessage;

  /** Runs one request; on success applies the new view, on failure shows the reason. `notice` is set when the workspace changes (the page reloads). */
  const act = async (label: string, method: string, url: string, body?: unknown, notice?: OrgNotice) => {
    if (busy) return false;
    setBusy(label); setErrorWhere(label); setErrorCode(""); setErrorStatus(0); setLocalError(""); setNotice(null);
    const reply = await call(method, url, body);
    setBusy("");
    if (!reply.ok) { setErrorCode(reply.data.error ?? "server_error"); setErrorStatus(reply.status); return false; }
    if (notice) { setOrgNotice(notice); onWorkspaceChanged(); return true; }
    setView(reply.data as OrgView);
    return true;
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    setErrorCode(""); setNotice(null); setErrorWhere("create");
    // The button is never greyed out: a problem with the code is explained here instead of the button silently doing nothing.
    if (choice === "own" && !normalizeCode(own)) { setLocalError("orgOwnCodeBad"); return; }
    setLocalError("");
    void act("create", "POST", "/api/org", { name: name.trim(), ...(choice === "own" ? { code: own } : {}), shareExisting: share && (view?.personalInterviews ?? 0) > 0 }, "created");
  };
  const join = (event: FormEvent) => {
    event.preventDefault();
    setErrorCode(""); setNotice(null); setErrorWhere("join");
    if (!joinCode.trim()) { setLocalError("orgJoinCodeEmpty"); return; }
    if (!normalizeCode(joinCode)) { setLocalError("orgOwnCodeBad"); return; }
    setLocalError("");
    void act("join", "POST", "/api/org/join", { code: joinCode }, "joined");
  };
  const saveCode = async (event: FormEvent) => { event.preventDefault(); if (await act("code", "PATCH", "/api/org", { code: newCode })) setNewCode(""); };
  const regenerate = () => { void act("code", "PATCH", "/api/org", { code: "generate" }); };
  const rename = (event: FormEvent) => { event.preventDefault(); void act("name", "PATCH", "/api/org", { name: newName }); };
  const removeMember = async (userId: string) => { if (await act("remove", "DELETE", `/api/org/members/${encodeURIComponent(userId)}`)) setConfirmRemove(null); };

  const copy = async () => {
    if (!view?.org) return;
    try { await navigator.clipboard.writeText(view.org.code); }
    catch { codeBox.current?.select(); try { document.execCommand("copy"); } catch { /* the code is selected, so Ctrl+C still works */ } }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!view) return <section className="org-panel" aria-label={t.businessCode}><p className="tr-fine" role={loadFailed ? "alert" : "status"}>{loadFailed ? (loadStatus ? format(t.orgErrWithStatus, { message: t.orgLoadError, status: loadStatus }) : t.orgLoadError) : t.orgLoading}</p>{loadFailed && <button type="button" className="button-secondary" onClick={() => void load()}>{t.orgRetry}</button>}</section>;

  const org = view.org;
  const isOwner = org?.role === "owner";
  const where = view.workspace === "org" && org ? format(t.orgWhereOrg, { name: org.name }) : t.orgWherePersonal;

  return (
    <section className="org-panel" aria-label={t.businessCode}>
      {notice && <p className="org-banner" role="status"><span aria-hidden="true">✓</span> {t[`orgBanner_${notice}` as DictKey]}</p>}
      {!org && <>
        <form className="org-card" onSubmit={create}>
          <h3>{t.orgCreateTitle}</h3>
          <label className="org-field"><span>{t.orgNameOptional}</span><input value={name} onChange={(event) => { setName(event.target.value); setLocalError(""); }} maxLength={80} placeholder={t.orgNamePh} disabled={Boolean(busy)} /><small>{t.orgNameHint}</small></label>
          <fieldset className="org-choice">
            <legend className="sr-only">{t.orgCreateTitle}</legend>
            {(["generate", "own"] as const).map((value) => (
              <label key={value}><input type="radio" name="org-choice" checked={choice === value} onChange={() => setChoice(value)} disabled={Boolean(busy)} />{t[`orgChoice_${value}` as DictKey]}</label>
            ))}
          </fieldset>
          {choice === "own" && (
            <label className="org-field"><span>{t.orgCodeLabel}</span>
              <input className="org-code-input" value={own} onChange={(event) => { setOwn(event.target.value.toUpperCase()); setLocalError(""); }} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="TRATA-TEAM-2026" disabled={Boolean(busy)} />
              <small>{t.orgCodeHint}</small>
            </label>
          )}
          {view.personalInterviews > 0 && <label className="org-check"><input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} disabled={Boolean(busy)} />{format(t.orgShareExisting, { n: view.personalInterviews })}</label>}
          {message && busy === "" && errorWhere === "create" && <p className="upload-error" role="alert">{message}</p>}
          <div><button className="button-primary" type="submit" disabled={Boolean(busy)}>{busy === "create" ? t.orgCreating : t.orgCreate}</button></div>
        </form>

        <form className="org-card" onSubmit={join}>
          <h3>{t.orgJoinTitle}</h3>
          <div className="org-inline">
            <input className="org-code-input" value={joinCode} onChange={(event) => { setJoinCode(event.target.value.toUpperCase()); setLocalError(""); }} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder={t.orgJoinPh} aria-label={t.orgJoinTitle} disabled={Boolean(busy)} />
            <button className="button-secondary" type="submit" disabled={Boolean(busy)}>{busy === "join" ? t.orgJoining : t.orgJoin}</button>
          </div>
          {message && busy === "" && errorWhere === "join" && <p className="upload-error" role="alert">{message}</p>}
        </form>
      </>}

      {org && <>
        <div className="org-card org-code-card">
          {!notice && <p className="org-ready"><span aria-hidden="true">✓</span> {t.orgCodeReady}</p>}
          <p className="org-org-name">{org.name}</p>
          <div className="org-inline">
            <input ref={codeBox} className="org-code-input org-code-big" value={org.code} readOnly onFocus={(event) => event.currentTarget.select()} aria-label={t.businessCode} />
            <button type="button" className="button-primary" onClick={() => void copy()}>{copied ? `✓ ${t.orgCopied}` : t.orgCopy}</button>
          </div>
          <p className="tr-fine" aria-live="polite">{t.orgShareHow}</p>
        </div>

        <div className="org-card">
          <p className="org-where">{format(t.orgYouAreIn, { where })}</p>
          <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => void act("switch", "POST", "/api/org/switch", { workspace: view.workspace === "org" ? "personal" : "org" }, view.workspace === "org" ? "switched_personal" : "switched_org")}>
            {view.workspace === "org" ? t.orgSwitchToPersonal : t.orgSwitchToOrg}
          </button>
        </div>

        {isOwner ? <>
          <form className="org-card" onSubmit={saveCode}>
            <h3>{t.orgChangeTitle}</h3>
            <div className="org-inline">
              <input className="org-code-input" value={newCode} onChange={(event) => setNewCode(event.target.value.toUpperCase())} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder={t.orgCodeLabel} aria-label={t.orgChangeTitle} disabled={Boolean(busy)} />
              <button className="button-secondary" type="submit" disabled={Boolean(busy) || !newCode.trim()}>{t.orgSaveCode}</button>
              <button className="button-secondary" type="button" disabled={Boolean(busy)} onClick={regenerate}>{t.orgRegenerate}</button>
            </div>
            <small className="tr-fine">{t.orgCodeHint} {t.orgChangeNote}</small>
          </form>
          <form className="org-card" onSubmit={rename}>
            <h3>{t.orgRenameTitle}</h3>
            <div className="org-inline">
              <input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} aria-label={t.orgRenameTitle} disabled={Boolean(busy)} />
              <button className="button-secondary" type="submit" disabled={Boolean(busy) || !newName.trim() || newName.trim() === org.name}>{t.orgSaveName}</button>
            </div>
          </form>
        </> : <p className="tr-fine">{t.orgOwnerOnly}</p>}

        <div className="org-card">
          <h3>{format(t.orgMembers, { n: org.members.length })}</h3>
          <ul className="org-members">
            {org.members.map((member) => (
              <li key={member.userId}>
                <span className="org-member-name"><span><b>{member.name}</b>{member.userId === view.you && <em> ({t.orgYou})</em>}</span><small>{member.email}</small></span>
                <span className={`org-role ${member.role}`}>{member.role === "owner" ? t.orgRoleOwner : t.orgRoleMember}</span>
                {isOwner && member.role !== "owner" && (confirmRemove === member.userId
                  ? <span className="org-confirm" role="alert">
                      <span>{format(t.orgRemoveAsk, { name: member.name })}</span>
                      <button type="button" className="button-danger" disabled={Boolean(busy)} onClick={() => void removeMember(member.userId)}>{t.orgRemoveYes}</button>
                      <button type="button" className="button-secondary" onClick={() => setConfirmRemove(null)}>{t.orgKeep}</button>
                    </span>
                  : <button type="button" className="button-link-danger" onClick={() => { setConfirmRemove(member.userId); setErrorCode(""); }}>{t.orgRemove}</button>)}
              </li>
            ))}
          </ul>
        </div>

        {!isOwner && (confirmLeave
          ? <div className="org-card org-confirm" role="alert">
              <span>{format(t.orgLeaveAsk, { name: org.name })}</span>
              <button type="button" className="button-danger" disabled={Boolean(busy)} onClick={() => void act("leave", "POST", "/api/org/leave", undefined, "left")}>{t.orgLeaveYes}</button>
              <button type="button" className="button-secondary" onClick={() => setConfirmLeave(false)}>{t.orgKeep}</button>
            </div>
          : <div><button type="button" className="button-link-danger" onClick={() => setConfirmLeave(true)}>{t.orgLeave}</button></div>)}
        {message && busy === "" && errorWhere !== "create" && errorWhere !== "join" && <p className="upload-error" role="alert">{message}</p>}
      </>}
    </section>
  );
}
