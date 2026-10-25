import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/server";
import { csvContents } from "@/lib/interviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { workspace, orgId, response } = await requireWorkspace(request);
  if (!workspace) return response;
  try {
    return new NextResponse(await csvContents(workspace, orgId), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=interviews.csv" } });
  } catch (error) {
    console.error("Unable to export interviews CSV", error);
    return NextResponse.json({ error: "Could not export interviews CSV." }, { status: 500 });
  }
}
