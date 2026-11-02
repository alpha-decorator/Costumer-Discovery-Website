"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/I18nProvider";
import { SAMPLE_CUSTOMERS, type Customer, type TierFilter } from "@/lib/customers";
import type { OrgView } from "@/lib/org-view";
import { applyPalette, currentPalette, isPalette, type PaletteId } from "@/lib/palette";

const HIDDEN_SAMPLES_KEY = "fieldnotes-hidden-samples";

type WorkspaceInfo = { workspace: "personal" | "org"; orgName: string | null } | null;

type WorkspaceValue = {
  loaded: boolean;
  recordsError: string;
  /** Interviews the person saved in this workspace. */
  uploaded: Customer[];
  /** Saved interviews followed by the example ones that have not been hidden. */
  customers: Customer[];
  tierFilter: TierFilter;
  setTierFilter: (filter: TierFilter) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  /** Colour theme (see palette.ts). Saved with light/dark to the person's account, so it follows them to every sign-in. */
  palette: PaletteId;
  setPalette: (palette: PaletteId) => void;
  workspaceInfo: WorkspaceInfo;
  applyOrgView: (view: OrgView) => void;
  isSaved: (customer: Customer) => boolean;
  upsertRecord: (record: Customer) => void;
  saveEdit: (draft: Customer) => Promise<Customer>;
  /** Deletes a saved interview, or hides an example one on this computer. Throws if the server refuses. */
  removeCustomer: (customer: Customer) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/**
 * Loads the saved interviews once for every signed-in page and keeps the filter, the selection and the theme shared between pages.
 * Sits in the (app) route group, so the sign-in pages never call the API.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const tRef = useRef(t);
  const [uploaded, setUploaded] = useState<Customer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [hiddenSamples, setHiddenSamples] = useState<string[]>([]);
  const [tierFilter, setTierFilter] = useState<TierFilter>("All");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [palette, setPaletteState] = useState<PaletteId>("royal");
  const prefsReady = useRef(false);
  const setPalette = useCallback((id: PaletteId) => { applyPalette(id); setPaletteState(id); }, []);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo>(null);

  useEffect(() => { tRef.current = t; }, [t]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("fieldnotes-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    try { const saved = JSON.parse(window.localStorage.getItem(HIDDEN_SAMPLES_KEY) ?? "[]") as unknown; if (Array.isArray(saved)) setHiddenSamples(saved.filter((id): id is string => typeof id === "string")); } catch { /* storage unavailable: samples simply stay visible */ }
  }, []);
  useEffect(() => { window.localStorage.setItem("fieldnotes-theme", theme); }, [theme]);

  // The account's saved look wins over this browser's. An account that has never chosen one takes this browser's choice.
  useEffect(() => {
    setPaletteState(currentPalette());
    let cancelled = false;
    fetch("/api/preferences").then(async (response) => {
      if (!response.ok || cancelled) return;
      const saved = await response.json() as { palette?: unknown; theme?: unknown };
      if (isPalette(saved.palette)) { applyPalette(saved.palette); setPaletteState(saved.palette); }
      if (saved.theme === "light" || saved.theme === "dark") setTheme(saved.theme);
      if (!isPalette(saved.palette) || (saved.theme !== "light" && saved.theme !== "dark")) {
        const localTheme = window.localStorage.getItem("fieldnotes-theme") === "dark" ? "dark" : "light";
        void fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ palette: isPalette(saved.palette) ? saved.palette : currentPalette(), theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : localTheme }) }).catch(() => {});
      }
    }).catch(() => { /* offline: keep this browser's look */ }).finally(() => { if (!cancelled) prefsReady.current = true; });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!prefsReady.current) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ palette, theme }) }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [palette, theme]);

  useEffect(() => {
    fetch("/api/interviews").then(async (response) => {
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (response.status === 403) {
        // The shared workspace was taken away (the owner removed this account). Fall back to the personal one.
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (body.error === "not_a_member") {
          const back = await fetch("/api/org/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: "personal" }) });
          if (back.ok) { window.location.reload(); return; }
        }
        throw new Error(tRef.current.errLoadInterviews);
      }
      if (!response.ok) throw new Error(tRef.current.errLoadInterviews);
      setUploaded(await response.json() as Customer[]);
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "";
      setRecordsError(/failed to fetch|network/i.test(detail) ? tRef.current.errServerUnreachable : detail || tRef.current.errLoadInterviews);
    }).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    fetch("/api/org").then(async (response) => {
      if (response.ok) { const view = await response.json() as OrgView; setWorkspaceInfo({ workspace: view.workspace, orgName: view.org?.name ?? null }); }
    }).catch(() => { /* the sidebar just shows the personal label */ });
  }, []);

  const customers = useMemo(() => [...uploaded, ...SAMPLE_CUSTOMERS.filter((customer) => !hiddenSamples.includes(customer.id))], [uploaded, hiddenSamples]);

  const isSaved = useCallback((customer: Customer) => uploaded.some((record) => record.id === customer.id), [uploaded]);

  const upsertRecord = useCallback((record: Customer) => {
    setUploaded((current) => current.some((item) => item.id === record.id) ? current.map((item) => item.id === record.id ? record : item) : [record, ...current]);
  }, []);

  const forget = useCallback((id: string) => {
    setUploaded((current) => current.filter((record) => record.id !== id));
    setSelectedIds((current) => current.filter((selected) => selected !== id));
  }, []);

  const saveEdit = useCallback(async (draft: Customer) => {
    const response = await fetch(`/api/interviews/${encodeURIComponent(draft.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "save failed");
    const saved = body as Customer;
    setUploaded((records) => records.map((record) => record.id === saved.id ? saved : record));
    return saved;
  }, []);

  const removeCustomer = useCallback(async (target: Customer) => {
    if (!uploaded.some((record) => record.id === target.id)) {
      const next = [...new Set([...hiddenSamples, target.id])];
      setHiddenSamples(next);
      try { window.localStorage.setItem(HIDDEN_SAMPLES_KEY, JSON.stringify(next)); } catch { /* hidden until reload only */ }
      forget(target.id);
      return;
    }
    const response = await fetch(`/api/interviews/${encodeURIComponent(target.id)}`, { method: "DELETE" });
    if (response.status === 401) { window.location.assign("/login"); return; }
    if (!response.ok && response.status !== 404) throw new Error("delete failed");
    forget(target.id);
  }, [uploaded, hiddenSamples, forget]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id]);
  }, []);

  const applyOrgView = useCallback((view: OrgView) => setWorkspaceInfo({ workspace: view.workspace, orgName: view.org?.name ?? null }), []);

  const value = useMemo<WorkspaceValue>(() => ({
    loaded, recordsError, uploaded, customers, tierFilter, setTierFilter, selectedIds, setSelectedIds, toggleSelected,
    theme, setTheme, palette, setPalette, workspaceInfo, applyOrgView, isSaved, upsertRecord, saveEdit, removeCustomer,
  }), [loaded, recordsError, uploaded, customers, tierFilter, selectedIds, toggleSelected, theme, palette, setPalette, workspaceInfo, applyOrgView, isSaved, upsertRecord, saveEdit, removeCustomer]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  return value;
}
