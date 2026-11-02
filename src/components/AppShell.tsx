"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/components/AuthProvider";
import { useI18n } from "@/components/I18nProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { ThemePicker } from "@/components/ThemePicker";
import { CITIES } from "@/lib/cities";

const NAV = [
  { href: "/", icon: "home", label: "discover" },
  { href: "/customers", icon: "users", label: "customers" },
  { href: "/reports", icon: "chart", label: "reports" },
  { href: "/business", icon: "key", label: "businessCode" },
  { href: "/settings", icon: "gear", label: "settings" },
] as const;

/**
 * The frame every signed-in page shares: a side menu on PC, an icon rail on tablets and a bottom bar on phones.
 * The round Upload button sits in the bottom-right corner on every page except the upload page itself.
 */
export function AppShell({ title, intro, actions, fab = true, children }: { title: string; intro?: string; actions?: ReactNode; fab?: boolean; children: ReactNode }) {
  const { lang, setLang, t } = useI18n();
  const { user, signOut } = useAuth();
  const { theme, setTheme, workspaceInfo } = useWorkspace();
  const pathname = usePathname();
  const [today, setToday] = useState("");
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  useEffect(() => { setToday(new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())); }, [lang]);

  const workspaceName = workspaceInfo ? (workspaceInfo.workspace === "org" && workspaceInfo.orgName ? workspaceInfo.orgName : t.wsPersonal) : "";
  const userInitials = (user?.name ?? "").trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  const current = NAV.find((item) => isActive(item.href));

  return <div className="app-shell fn-app" lang={lang} data-theme={theme}>
    <aside className="fn-sidebar">
      <Link className="fn-brand" href="/" aria-label={t.brandAria}><span className="brand-mark">f<span>.</span></span><span className="fn-brand-name">fieldnotes<span className="brand-dot">.</span></span></Link>
      <div className="workspace-label">{t.workspace}</div>
      <nav className="fn-nav" aria-label={t.workspace}>
        {NAV.map((item) => <Link key={item.href} href={item.href} className={`fn-nav-item${isActive(item.href) ? " active" : ""}`} aria-current={isActive(item.href) ? "page" : undefined} title={t[item.label]}><Icon name={item.icon} /><span>{t[item.label]}</span></Link>)}
      </nav>
      <div className="fn-sidebar-bottom">
        <Link href="/business" className="fn-workspace" title={t.businessCode}><span className="project-icon">{Array.from(workspaceName || "S")[0]?.toUpperCase()}</span><span className="fn-workspace-name">{workspaceName || " "}</span></Link>
        <div className="profile"><div className="avatar avatar-maya">{userInitials}</div><div className="profile-copy"><strong>{user?.name}</strong><span>{user?.email}</span></div></div>
      </div>
    </aside>
    <div className="fn-main">
      <header className="fn-topbar">
        <Link className="fn-brand fn-brand-mobile" href="/" aria-label={t.brandAria}><span className="brand-mark">f<span>.</span></span><span className="fn-brand-name">fieldnotes<span className="brand-dot">.</span></span></Link>
        <div className="breadcrumb"><span>{workspaceName || t.studioWorkspace}</span><Icon name="chevron" size={14} /><strong>{current ? t[current.label] : title}</strong></div>
        <div className="top-actions">
          <button className="language-toggle" onClick={() => setLang(lang === "en" ? "hi" : "en")} aria-label={t.switchLanguage}><Icon name="globe" size={16} /><span>{lang === "en" ? "EN" : "हि"}</span></button>
          <ThemePicker />
          <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? t.switchToDark : t.switchToLight} title={theme === "light" ? t.switchToDark : t.switchToLight}><Icon name={theme === "light" ? "moon" : "sun"} size={17} /></button>
          <Link className="top-avatar" href="/settings" aria-label={t.profileSettings}>{userInitials}</Link>
          <button className="icon-button signout-button" aria-label={t.signOut} title={t.signOut} onClick={signOut}><Icon name="logout" size={17} /></button>
        </div>
      </header>
      <div className="fn-content">
        <div className="fn-head">
          <div>
            <p className="eyebrow">{today}</p>
            <h1>{title}</h1>
            {intro && <p className="intro">{intro}</p>}
          </div>
          {actions && <div className="fn-head-actions">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
    {fab && <Link className="fn-fab" href="/upload" aria-label={t.addNotes}><Icon name="upload" size={18} /><span>{L("Upload", "अपलोड")}</span></Link>}
    <datalist id="fn-cities">{CITIES.map((city) => <option key={city.name} value={city.name} />)}</datalist>
    <nav className="fn-tabbar" aria-label={t.workspace}>
      {NAV.map((item) => <Link key={item.href} href={item.href} className={`fn-tab${isActive(item.href) ? " active" : ""}`} aria-current={isActive(item.href) ? "page" : undefined}><Icon name={item.icon} size={20} /><span>{t[item.label]}</span></Link>)}
    </nav>
  </div>;
}
