"use client";

import { AppShell } from "@/components/AppShell";
import { OrgPanel } from "@/components/OrgPanel";
import { useI18n } from "@/components/I18nProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";

/** The business code screen. Its behaviour is unchanged; it only sits inside the new page frame. */
export default function BusinessPage() {
  const { t } = useI18n();
  const { workspaceInfo, applyOrgView } = useWorkspace();
  return <AppShell title={t.businessCode} intro={workspaceInfo?.orgName ? t.orgPageIntro : t.orgIntro} fab={false}>
    <OrgPanel onWorkspaceChanged={() => window.location.reload()} onViewChange={applyOrgView} />
  </AppShell>;
}
