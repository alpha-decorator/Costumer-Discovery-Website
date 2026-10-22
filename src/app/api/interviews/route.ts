import { NextResponse } from "next/server";
import { isValidInterview, listInterviews, saveInterview } from "@/lib/interviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await listInterviews()); }
  catch (error) { console.error("Unable to read interview database", error); return NextResponse.json({ error: "Could not read saved interviews." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isValidInterview(body)) return NextResponse.json({ error: "Interview data is incomplete or invalid." }, { status: 400 });
    return NextResponse.json(await saveInterview(body), { status: 201 });
  } catch (error) {
    console.error("Unable to save interview", error);
    return NextResponse.json({ error: "Could not save interview to the database and CSV." }, { status: 500 });
  }
}
