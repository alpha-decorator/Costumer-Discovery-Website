"use client";

import { useState, type FormEvent } from "react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n } from "@/components/I18nProvider";
import type { DictKey } from "@/lib/i18n";
import { setOrgNotice } from "@/lib/org-notice";
import { applyPalette, isPalette } from "@/lib/palette";

type Mode = "personal" | "join" | "create";
type Props = { mode: "login" | "register"; googleEnabled: boolean; next: string; urlError?: string; initialTab?: "personal" | "institution"; initialMode?: Mode };
type Tab = "personal" | "institution";

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.4-4.7 7l7.3 5.7c4.3-4 6.8-9.9 6.8-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function AuthForm({ mode, googleEnabled, next, urlError, initialTab = "personal", initialMode = "personal" }: Props) {
  const { t } = useI18n();
  const isLogin = mode === "login";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState(urlError ?? "");
  const [errorStatus, setErrorStatus] = useState(0);
  const [regMode, setRegMode] = useState<Mode>(isLogin ? "personal" : initialMode);
  const [businessName, setBusinessName] = useState("");
  const [tab, setTab] = useState<Tab>(isLogin ? initialTab : "personal");
  const [orgCode, setOrgCode] = useState("");
  const institution = isLogin && tab === "institution";
  const codeText = orgCode.trim();
  // A code is sent on the institution tab, and on the register page when the person chose "Join my business".
  const joining = !isLogin && regMode === "join";
  const creating = !isLogin && regMode === "create";
  const sendCode = institution || (joining && codeText !== "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorCode("");
    setErrorStatus(0);
    try {
      const response = await fetch(isLogin ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isLogin ? { email, password } : { name, email, password }),
          ...(sendCode ? { code: codeText } : {}),
          ...(creating ? { newBusiness: true, businessName: businessName.trim() } : {}),
        }),
      });
      if (response.ok) {
        const done = await response.json().catch(() => ({})) as { org?: boolean; businessFailed?: boolean; preferences?: { palette?: unknown; theme?: unknown } };
        // Put the account's saved look in place before the next page paints, so it opens in the right theme straight away.
        if (isPalette(done.preferences?.palette)) applyPalette(done.preferences.palette);
        if (done.preferences?.theme === "light" || done.preferences?.theme === "dark") { try { window.localStorage.setItem("fieldnotes-theme", done.preferences.theme); } catch { /* storage blocked */ } }
        // The next page opens on the Business code screen with a short message ("your code is ready" / "you joined").
        if (creating) setOrgNotice(done.businessFailed ? "create_failed" : "created");
        else if (joining && done.org) setOrgNotice("joined");
        // A full page load lets the server read the new session cookie.
        window.location.assign(next);
        return;
      }
      const body = await response.json().catch(() => ({})) as { error?: string };
      setErrorCode(body.error ?? "server_error");
      setErrorStatus(response.status);
    } catch {
      setErrorCode("network");
    }
    setBusy(false);
  };

  // "invalid_code" with status 404 means a well-formed code that nobody owns; with 400 it is badly spelled.
  const errorKey = errorCode === "invalid_code" && errorStatus === 404 ? "code_not_found" : errorCode;
  const message = errorKey ? (t[`authErr_${errorKey}` as DictKey] ?? t.authErr_server_error) : "";
  const nextQuery = next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  const googleWaits = (institution || joining) && !codeText;
  const googleHref = `/api/auth/google?next=${encodeURIComponent(next)}${sendCode && codeText ? `&code=${encodeURIComponent(codeText)}` : ""}`;
  const chooseTab = (value: Tab) => { setTab(value); setErrorCode(""); };

  return (
    <main className="auth-page">
      <div className="auth-lang"><LanguageSwitch /></div>
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="brand auth-brand" href="/" aria-label={t.brandAria}><span className="brand-mark">f<span>.</span></span><span className="brand-name">fieldnotes<span className="brand-dot">.</span></span></a>
        <h1 id="auth-title">{isLogin ? t.loginTitle : t.registerTitle}</h1>
        <p className="auth-sub">{institution ? t.loginInstSubtitle : isLogin ? t.loginSubtitle : t.registerSubtitle}</p>

        {isLogin && (
          <div className="auth-tabs" role="tablist" aria-label={t.signIn}>
            {(["personal", "institution"] as const).map((value) => (
              <button key={value} type="button" role="tab" id={`auth-tab-${value}`} aria-selected={tab === value} className={tab === value ? "on" : ""} onClick={() => chooseTab(value)} disabled={busy}>
                {value === "personal" ? t.loginTabPersonal : t.loginTabInstitution}
              </button>
            ))}
          </div>
        )}

        {institution && (
          <label className="auth-code-field">
            <span>{t.orgCodeFieldLabel}</span>
            <input className="auth-code" value={orgCode} onChange={(event) => setOrgCode(event.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} placeholder="XXXX-XXXX" required disabled={busy} />
            <small>{t.orgCodeFieldHint}</small>
          </label>
        )}

        {googleEnabled && <>
          {googleWaits
            ? <span className="google-button disabled" aria-disabled="true"><GoogleLogo />{t.continueGoogle}</span>
            : <a className="google-button" href={googleHref}><GoogleLogo />{t.continueGoogle}</a>}
          {googleWaits && <p className="auth-note">{t.googleNeedsCode}</p>}
          <div className="auth-divider"><span>{t.orWithEmail}</span></div>
        </>}

        <form className="auth-form" onSubmit={submit} noValidate>
          {!isLogin && <label><span>{t.nameLabel}</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={80} disabled={busy} /></label>}
          <label><span>{t.emailLabel}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required disabled={busy} /></label>
          <label>
            <span>{t.passwordLabel}</span>
            <div className="password-row">
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isLogin ? "current-password" : "new-password"} minLength={8} maxLength={128} required disabled={busy} />
              <button type="button" onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? t.hidePassword : t.showPassword}</button>
            </div>
            {!isLogin && <small>{t.passwordHint}</small>}
          </label>
          {!isLogin && (
            <fieldset className="reg-modes" disabled={busy}>
              <legend>{t.regModeLabel}</legend>
              {(["personal", "join", "create"] as const).map((value) => (
                <label key={value}><input type="radio" name="reg-mode" checked={regMode === value} onChange={() => { setRegMode(value); setErrorCode(""); }} />{value === "personal" ? t.regModePersonal : value === "join" ? t.regModeJoin : t.regModeCreate}</label>
              ))}
            </fieldset>
          )}
          {joining && (
            <label>
              <span>{t.orgCodeFieldLabel}</span>
              <input className="auth-code" value={orgCode} onChange={(event) => setOrgCode(event.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} placeholder="XXXX-XXXX" disabled={busy} />
              <small>{t.regJoinHint}</small>
            </label>
          )}
          {creating && (
            <label>
              <span>{t.regBusinessNameLabel}</span>
              <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} maxLength={80} placeholder={t.orgNamePh} disabled={busy} />
              <small>{t.regBusinessNameHint}</small>
            </label>
          )}
          {message && <p className="upload-error" role="alert">{message}</p>}
          <button className="button-primary auth-submit" type="submit" disabled={busy || !email || !password || ((institution || joining) && !codeText)}>
            {isLogin ? (busy ? t.signingIn : t.signIn) : (busy ? t.creatingAccount : t.createAccount)}
          </button>
        </form>

        {institution && errorKey === "code_not_found" && <p className="auth-create-link"><a href={`/register?mode=create${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`}>{t.authCreateInstead}</a></p>}
        <p className="auth-switch">{isLogin ? t.noAccount : t.haveAccount} <a href={`${isLogin ? "/register" : "/login"}${nextQuery}`}>{isLogin ? t.createAccount : t.signIn}</a></p>
      </section>
    </main>
  );
}
