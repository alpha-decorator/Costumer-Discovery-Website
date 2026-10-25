import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/server";
import { interviewProblem, isValidInterview, listInterviews, saveInterview } from "@/lib/interviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user, workspace, orgId, response } = await requireWorkspace(request);
  if (!workspace) return response;
  try { return NextResponse.json(await listInterviews(workspace, orgId)); }
  catch (error) { console.error("Unable to read interview database", error); return NextResponse.json({ error: "Could not read saved interviews." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const { user, workspace, orgId, response } = await requireWorkspace(request);
  if (!workspace) return response;
  try {
    const body: unknown = await request.json();
    if (!isValidInterview(body)) return NextResponse.json({ error: "Interview data is incomplete or invalid.", detail: interviewProblem(body) }, { status: 400 });
    return NextResponse.json(await saveInterview(body, workspace, user.id), { status: 201 });
  } catch (error) {
    console.error("Unable to save interview", error);
    return NextResponse.json({ error: "Could not save interview to the database and CSV." }, { status: 500 });
  }
}
