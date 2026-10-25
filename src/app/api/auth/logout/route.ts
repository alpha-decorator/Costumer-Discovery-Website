import { NextResponse } from "next/server";
import { clearSession, isSameOrigin } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return clearSession(NextResponse.json({ ok: true }));
}
