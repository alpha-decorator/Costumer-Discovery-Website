import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { engineHeaders, engineUrl } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells the page whether the high-accuracy engine is running. Offline is a normal answer (the page then uses the in-browser model). */
export async function GET(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const reply = await fetch(`${engineUrl()}/health`, { headers: engineHeaders(), signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!reply.ok) return NextResponse.json({ online: false, reason: reply.status === 401 ? "token" : "error" });
    const health = await reply.json() as { asr?: { indic?: { available?: boolean; reason?: string }; whisper?: { available?: boolean } }; llm?: { ok?: boolean; model?: string | null; detail?: string; small?: boolean }; version?: string; jobs?: { queued?: number; running?: number } };
    return NextResponse.json({
      online: true, version: health.version ?? "",
      indic: !!health.asr?.indic?.available, whisper: !!health.asr?.whisper?.available,
      llm: !!health.llm?.ok, llmModel: health.llm?.model ?? null, llmDetail: health.llm?.ok ? "" : String(health.llm?.detail ?? "").slice(0, 200),
      llmSmall: !!health.llm?.small, indicReason: health.asr?.indic?.available ? "" : String(health.asr?.indic?.reason ?? "").slice(0, 500),
      busy: (health.jobs?.queued ?? 0) + (health.jobs?.running ?? 0),
    });
  } catch {
    return NextResponse.json({ online: false, reason: "offline" });
  }
}
