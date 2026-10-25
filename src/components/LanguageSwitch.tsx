"use client";

import { useI18n } from "@/components/I18nProvider";

/** EN / हि toggle for pages that do not have the dashboard top bar (sign in and register). */
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <button type="button" className="language-toggle" onClick={() => setLang(lang === "en" ? "hi" : "en")} aria-label={t.switchLanguage} title={t.switchLanguage}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
      <span>{lang === "en" ? "EN → हि" : "हि → EN"}</span>
    </button>
  );
}
