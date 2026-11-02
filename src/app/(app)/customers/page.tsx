"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CustomerDetail } from "@/components/CustomerDetail";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/components/I18nProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { TrataReport } from "@/components/TrataReport";
import { DetailedReport, type ReportScope } from "@/components/DetailedReport";
import { TIERS, initialsColor, signed, tierColor, type Customer, type Tier, type TierFilter } from "@/lib/customers";
import { format } from "@/lib/i18n";

export default function CustomersPage() {
  const { lang, t } = useI18n();
  const { loaded, recordsError, customers, uploaded, tierFilter, setTierFilter, selectedIds, setSelectedIds, toggleSelected, removeCustomer, isSaved } = useWorkspace();
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reportFor, setReportFor] = useState<Customer | null>(null);
  const [pdfScope, setPdfScope] = useState<ReportScope | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Home-page links arrive as /customers?open=ID and open that customer straight away.
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) setOpenId(open);
  }, []);

  const tierName = (tier: Tier) => tier === "Expert" ? t.tierExpert : tier === "Public" ? t.tierPublic : t.tierNewbie;
  const filterName = (value: TierFilter) => value === "All" ? t.all : tierName(value);
  const visible = useMemo(() => customers.filter((customer) => (tierFilter === "All" || customer.tier === tierFilter) && `${customer.name} ${customer.company}`.toLowerCase().includes(query.trim().toLowerCase())), [customers, tierFilter, query]);
  const active = openId ? customers.find((customer) => customer.id === openId) ?? null : null;
  const allVisibleSelected = visible.length > 0 && visible.every((customer) => selectedIds.includes(customer.id));
  const toggleVisible = () => setSelectedIds(allVisibleSelected ? selectedIds.filter((id) => !visible.some((customer) => customer.id === id)) : [...new Set([...selectedIds, ...visible.map((customer) => customer.id)])]);
  const closeDetail = () => { setOpenId(null); setEditing(false); };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      await removeCustomer(deleteTarget);
      if (openId === deleteTarget.id) setOpenId(null);
      setDeleteTarget(null);
    } catch { setDeleteError(t.deleteFailed); }
    finally { setDeleting(false); }
  };

  return <AppShell title={t.customers} intro={L("Everyone you have interviewed. Click a customer to see the details.", "आपके सभी इंटरव्यू किए गए ग्राहक। विवरण देखने के लिए ग्राहक पर क्लिक करें।")}
    actions={<Link className="button-secondary" href="/reports"><Icon name="chart" size={15} />{L("Open report", "रिपोर्ट खोलें")}</Link>}>
    <section className="fn-card fn-toolbar">
      <label className="search-box fn-search"><Icon name="search" size={17} /><input aria-label={t.search} placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="fn-chips" role="tablist" aria-label={t.filter}>
        {(["All", ...TIERS] as TierFilter[]).map((value) => <button key={value} role="tab" aria-selected={tierFilter === value} className={tierFilter === value ? "on" : ""} onClick={() => setTierFilter(value)}>{filterName(value)} <b>{value === "All" ? customers.length : customers.filter((customer) => customer.tier === value).length}</b></button>)}
      </div>
    </section>

    {recordsError && <p className="upload-error" role="alert">{recordsError}</p>}

    <section className="fn-card fn-table-card">
      <div className="fn-table-head">
        <span className="sample-label">{uploaded.length ? `${uploaded.length} ${t.savedWord}` : t.sample}</span>
        <div className="fn-table-meta">
          {selectedIds.length > 0 && <span className="selected-count">{selectedIds.length} {t.checked}</span>}
          {selectedIds.length > 0 && <button className="button-secondary fn-small" onClick={() => setPdfScope({ kind: "selection", title: L("Selected customers", "चयनित ग्राहक"), customers: customers.filter((customer) => selectedIds.includes(customer.id)) })}>{L("Report for selected", "चयनित की रिपोर्ट")}</button>}
          {selectedIds.length > 0 && <button className="text-link" onClick={() => setSelectedIds([])}>{t.clearSelection}</button>}
        </div>
      </div>
      <div className="fn-table-wrap">
        <table>
          <thead><tr>
            <th className="select-column"><input className="row-checkbox" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label={t.selectAllAria} /></th>
            <th>{t.person}</th><th>{t.tier}</th><th className="fn-hide-sm">{t.date}</th><th>{t.score}</th><th className="fn-hide-sm">{L("Main point", "मुख्य बात")}</th><th aria-label={t.action} />
          </tr></thead>
          <tbody>
            {visible.map((customer) => <tr key={customer.id} className={selectedIds.includes(customer.id) ? "selected-row" : ""}>
              <td className="select-column"><input className="row-checkbox" type="checkbox" checked={selectedIds.includes(customer.id)} onChange={() => toggleSelected(customer.id)} aria-label={format(t.selectOneAria, { name: customer.name })} /></td>
              <td><button className="person-cell" onClick={() => setOpenId(customer.id)}><span className={`avatar avatar-${initialsColor(customer.name)}`}>{customer.initials}</span><span className="person-info"><strong>{customer.name}</strong><small>{customer.company}</small></span></button></td>
              <td><span className={`tier-pill tier-${customer.tier.toLowerCase()}`}><i style={{ background: tierColor(customer.tier) }} />{tierName(customer.tier)}</span></td>
              <td className="date-cell fn-hide-sm">{customer.date}</td>
              <td><span className={`score ${customer.sentiment >= 0.6 ? "score-positive" : "score-mixed"}`}><i />{signed(customer.sentiment)}</span></td>
              <td className="fn-hide-sm"><span className="fn-keyword">{customer.keyPoints[0]}</span></td>
              <td><span className="fn-row-actions">{isSaved(customer) && <button className="row-action fn-row-edit" onClick={() => { setEditing(true); setOpenId(customer.id); }} aria-label={`${L("Edit", "बदलें")} ${customer.name}`}><Icon name="pencil" size={14} />{L("Edit", "बदलें")}</button>}<button className="row-action" onClick={() => { setEditing(false); setOpenId(customer.id); }}>{t.view}<Icon name="chevron" size={14} /></button></span></td>
            </tr>)}
          </tbody>
        </table>
        {!loaded && <div className="empty-results">{L("Loading…", "लोड हो रहा है…")}</div>}
        {loaded && visible.length === 0 && <div className="empty-results">{t.noMatches}</div>}
      </div>
    </section>

    {active && <CustomerDetail key={`${active.id}-${editing}`} startEditing={editing} customer={active} group={customers.filter((customer) => tierFilter === "All" || customer.tier === tierFilter)} onClose={closeDetail} onReport={(customer) => { setReportFor(customer); closeDetail(); }} onPdf={(customer) => setPdfScope({ kind: "customer", title: customer.name, customers, customer })} onAskDelete={(customer) => { setDeleteError(""); setDeleteTarget(customer); }} />}
    {pdfScope && <DetailedReport scope={pdfScope} onClose={() => setPdfScope(null)} />}
    {reportFor && <TrataReport customer={reportFor} onClose={() => setReportFor(null)} onManage={() => { setOpenId(reportFor.id); setReportFor(null); }} />}

    {deleteTarget && <div className="modal-backdrop" role="presentation" onClick={() => { if (!deleting) setDeleteTarget(null); }}>
      <section className="detail-modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-body" onClick={(event) => event.stopPropagation()}>
        <h2 id="delete-title">{format(t.deleteTitle, { name: deleteTarget.name })}</h2>
        <p id="delete-body">{isSaved(deleteTarget) ? t.deleteBody : t.deleteSampleBody}</p>
        {deleteError && <p className="upload-error" role="alert">{deleteError}</p>}
        <div className="upload-actions"><button className="button-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>{t.cancel}</button><button className="button-danger" onClick={() => void confirmDelete()} disabled={deleting} autoFocus>{deleting ? t.deleting : t.deleteConfirm}</button></div>
      </section>
    </div>}
  </AppShell>;
}
