import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { MAX_UPLOAD_BYTES, engineHeaders, engineUrl, scopedKey } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts a transcription + analysis job. The audio (or a JSON `{text}` body for typed notes) is streamed straight through to the engine. */
export async function POST(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") === "text" ? "text" : "audio";
  const language = ["auto", "hi", "en"].includes(params.get("language") ?? "") ? params.get("language")! : "auto";
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const target = new URL(`${engineUrl()}/jobs`);
  target.searchParams.set("kind", kind);
  target.searchParams.set("language", language);
  target.searchParams.set("filename", (params.get("filename") ?? "").slice(0, 200));
  const key = scopedKey(user.id, (params.get("client_key") ?? "").slice(0, 150));
  if (key) target.searchParams.set("client_key", key);

  const headers = engineHeaders({ "Content-Type": request.headers.get("content-type") ?? "application/octet-stream" });
  if (length) headers["Content-Length"] = String(length);
  try {
    const upstream = await fetch(target, { method: "POST", headers, body: request.body, duplex: "half", signal: request.signal } as RequestInit & { duplex: "half" });
    const body = await upstream.json().catch(() => ({ error: "engine_error" }));
    return NextResponse.json(body, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: "engine_offline" }, { status: 503 });
  }
}
