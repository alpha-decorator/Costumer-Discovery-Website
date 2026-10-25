"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/components/I18nProvider";
import { DetailedReport, type ReportScope } from "@/components/DetailedReport";
import { MentionsBoard } from "@/components/MentionsBoard";
import { TrataReport } from "@/components/TrataReport";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { TIERS, signed, summarize, tierColor, type Customer, type Tier } from "@/lib/customers";

export default function ReportsPage() {
  const { t, lang } = useI18n();
  const { customers, selectedIds, setSelectedIds } = useWorkspace();
  const [report, setReport] = useState<ReportScope | null>(null);
  const [reportFor, setReportFor] = useState<Customer | null>(null);
  const L = (en: string, hi: string) => lang === "hi" ? hi : en;
  const tierName = (tier: Tier) => tier === "Expert" ? t.tierExpert : tier === "Public" ? t.tierPublic : t.tierNewbie;
  const selected = useMemo(() => customers.filter((customer) => selectedIds.includes(customer.id)), [customers, selectedIds]);

  // Every group gets its own report. The overall one covers all customers; each tier covers only that tier.
  const groups: Array<{ key: string; label: string; scope: ReportScope; color: string }> = [
    { key: "overall", label: L("Overall insights", "सामान्य अंतर्दृष्टि"), scope: { kind: "overall", title: L("Overall insights", "सामान्य अंतर्दृष्टि"), customers }, color: "var(--ink)" },
    ...TIERS.map((tier) => ({ key: tier, label: tierName(tier), scope: { kind: "tier" as const, title: tierName(tier), customers: customers.filter((customer) => customer.tier === tier) }, color: tierColor(tier) })),
  ];
  if (selected.length) groups.push({ key: "selection", label: `${L("Selected", "चयनित")} (${selected.length})`, scope: { kind: "selection", title: L("Selected customers", "चयनित ग्राहक"), customers: selected }, color: "var(--muted)" });

  const exportMarkdown = () => {
    const lines = customers.map((customer) => `- ${customer.name} (${customer.company}, ${tierName(customer.tier)}): ${signed(customer.sentiment)} · ${customer.keyPoints.join("; ")}`);
    const stats = summarize(customers);
    const body = [`# ${L("Customer discovery report", "ग्राहक खोज रिपोर्ट")}`, "", `${t.simple}: ${signed(stats.simple)} · ${t.weighted}: ${signed(stats.weighted)}`, "", ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `customer-discovery-${new Date().toISOString().slice(0, 10)}.md`; link.click(); URL.revokeObjectURL(url);
  };

  return <AppShell title={t.reports} intro={L("Pick a group to open its full report. Each report can be downloaded as a PDF.", "पूरी रिपोर्ट देखने के लिए कोई समूह चुनें। हर रिपोर्ट PDF में डाउनलोड की जा सकती है।")}
    actions={<button className="button-secondary" onClick={exportMarkdown}><Icon name="arrow" size={15} />{L("Export data (.md)", "डेटा निर्यात करें (.md)")}</button>}>
    <section className="fn-report-groups">
      {groups.map((group) => {
        const stats = summarize(group.scope.customers);
        return <article className="fn-card fn-report-card" key={group.key}>
          <div className="fn-report-card-head"><span className="report-dot" style={{ background: group.color }} /><h2>{group.label}</h2></div>
          <div className="fn-report-card-stats">
            <div><span>{t.simple}</span><strong className={stats.simple >= 0 ? "tone-pos" : "tone-neg"}>{group.scope.customers.length ? signed(stats.simple) : "—"}</strong></div>
            <div><span>{t.weighted}</span><strong className={stats.weighted >= 0 ? "tone-pos" : "tone-neg"}>{group.scope.customers.length ? signed(stats.weighted) : "—"}</strong></div>
            <div><span>{t.customersCovered}</span><strong>{group.scope.customers.length}</strong></div>
          </div>
          <button className="button-primary" onClick={() => setReport(group.scope)}><Icon name="arrow" size={15} />{L("Open report & PDF", "रिपोर्ट और PDF खोलें")}</button>
        </article>;
      })}
    </section>

    <section className="fn-card">
      <div className="fn-row-head"><div><h2>{L("Individual customers", "व्यक्तिगत ग्राहक")}</h2><p className="fn-card-sub">{L("Open one customer's report, or tick customers on the Customers page to report on them together.", "किसी एक ग्राहक की रिपोर्ट खोलें, या ग्राहक पेज पर चुनकर उन्हें एक साथ रिपोर्ट करें।")}</p></div>{selectedIds.length > 0 && <button className="text-link" onClick={() => setSelectedIds([])}>{t.clearSelection}</button>}</div>
      <div className="points-list">
        {customers.map((customer) => <div className="fn-report-row" key={customer.id}>
          <span className="person-info"><strong>{customer.name}</strong><small>{customer.company} · {tierName(customer.tier)} · {customer.date}</small></span>
          <span className={`score ${customer.sentiment >= 0.6 ? "score-positive" : "score-mixed"}`}><i />{signed(customer.sentiment)}</span>
          <span className="fn-report-row-actions">
            <button className="row-action" onClick={() => setReport({ kind: "customer", title: customer.name, customers, customer })}>PDF<Icon name="arrow" size={13} /></button>
            {customer.analysis && <button className="row-action" onClick={() => setReportFor(customer)}>{t.trReportOpen}<Icon name="chevron" size={14} /></button>}
          </span>
        </div>)}
        {!customers.length && <p className="no-points">{t.noInterviewsMatch}</p>}
      </div>
    </section>

    <MentionsBoard customers={customers} onOpen={(customer) => setReportFor(customer)} />
    <p className="report-note">{t.accuracyShort}</p>

    {report && <DetailedReport scope={report} onClose={() => setReport(null)} />}
    {reportFor && <TrataReport customer={reportFor} onClose={() => setReportFor(null)} />}
  </AppShell>;
}
