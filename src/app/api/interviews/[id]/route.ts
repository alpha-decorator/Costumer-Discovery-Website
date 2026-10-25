import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/server";
import { deleteInterview, interviewProblem, isValidInterview, updateInterview } from "@/lib/interviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { workspace, orgId, response } = await requireWorkspace(request);
  if (!workspace) return response;
  try {
    const { id } = await context.params;
    const body: unknown = await request.json();
    if (!isValidInterview(body) || body.id !== id) return NextResponse.json({ error: "Interview data is incomplete or invalid.", detail: isValidInterview(body) ? "the id does not match the address" : interviewProblem(body) }, { status: 400 });
    const updated = await updateInterview(id, body, workspace, orgId);
    return updated ? NextResponse.json(updated) : NextResponse.json({ error: "Interview not found." }, { status: 404 });
  } catch (error) {
    console.error("Unable to update interview", error);
    return NextResponse.json({ error: "Could not update interview in the database and CSV." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { workspace, orgId, response } = await requireWorkspace(request);
  if (!workspace) return response;
  try {
    const { id } = await context.params;
    return (await deleteInterview(id, workspace, orgId)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Interview not found." }, { status: 404 });
  } catch (error) {
    console.error("Unable to delete interview", error);
    return NextResponse.json({ error: "Could not delete the interview." }, { status: 500 });
  }
}
