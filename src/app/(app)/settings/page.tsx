"use client";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { useI18n } from "@/components/I18nProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { format } from "@/lib/i18n";

export default function SettingsPage() {
  const { lang, setLang, t } = useI18n();
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useWorkspace();
  return <AppShell title={t.settings} intro={t.settingsIntro} fab={false}>
    <section className="fn-card settings-list">
      <div className="settings-row"><div><strong>{t.appearance}</strong><span>{theme === "light" ? t.lightModePlain : t.darkModePlain}</span></div><button className="button-secondary" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? t.switchToDark : t.switchToLight}</button></div>
      <div className="settings-row"><div><strong>{t.interfaceLanguage}</strong><span>{lang === "en" ? "English" : "हिन्दी"}</span></div><button className="button-secondary" onClick={() => setLang(lang === "en" ? "hi" : "en")}>{t.switchLanguage}</button></div>
      <div className="settings-row"><div><strong>{t.storageHeading}</strong><span>{t.storageBody}</span></div><a className="button-secondary" href="/api/interviews/csv">{t.downloadInterviewCsv}</a></div>
      <div className="settings-row"><div><strong>{t.account}</strong><span>{user ? format(t.signedInAs, { email: user.email }) : ""} · {t.accountSub}</span></div><button className="button-secondary" onClick={signOut}>{t.signOut}</button></div>
    </section>
  </AppShell>;
}
