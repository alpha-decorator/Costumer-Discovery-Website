import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { engineHeaders, engineUrl } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[0-9a-f]{8,32}$/;

async function relay(request: Request, params: Promise<{ id: string }>, method: "GET" | "DELETE") {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const upstream = await fetch(`${engineUrl()}/jobs/${id}`, { method, headers: engineHeaders(), signal: AbortSignal.timeout(15000), cache: "no-store" });
    return NextResponse.json(await upstream.json().catch(() => ({ error: "engine_error" })), { status: upstream.status });
  } catch {
    return NextResponse.json({ error: "engine_offline" }, { status: 503 });
  }
}

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => relay(request, context.params, "GET");
export const DELETE = (request: Request, context: { params: Promise<{ id: string }> }) => relay(request, context.params, "DELETE");
