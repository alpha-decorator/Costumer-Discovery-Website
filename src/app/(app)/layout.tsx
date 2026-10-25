import type { ReactNode } from "react";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";

/** Every signed-in page loads the saved interviews once here, so moving between pages keeps the filter and selection. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
