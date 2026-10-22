import { NextResponse } from "next/server";
import { isValidInterview, updateInterview } from "@/lib/interviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body: unknown = await request.json();
    if (!isValidInterview(body) || body.id !== id) return NextResponse.json({ error: "Interview data is incomplete or invalid." }, { status: 400 });
    const updated = await updateInterview(id, body);
    return updated ? NextResponse.json(updated) : NextResponse.json({ error: "Interview not found." }, { status: 404 });
  } catch (error) {
    console.error("Unable to update interview", error);
    return NextResponse.json({ error: "Could not update interview in the database and CSV." }, { status: 500 });
  }
}
