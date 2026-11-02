import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { isPalette } from "@/lib/palette";
import { getPreferences, savePreferences } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in person's saved look: { palette, theme }, each null until they first choose. */
export async function GET(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try { return NextResponse.json(await getPreferences(user.id)); }
  catch (error) { console.error("Unable to read preferences", error); return NextResponse.json({ error: "server_error" }, { status: 500 }); }
}

export async function PUT(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }
  const { palette, theme } = (body ?? {}) as { palette?: unknown; theme?: unknown };
  if (!isPalette(palette) || (theme !== "light" && theme !== "dark")) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try { await savePreferences(user.id, { palette, theme }); return NextResponse.json({ ok: true }); }
  catch (error) { console.error("Unable to save preferences", error); return NextResponse.json({ error: "server_error" }, { status: 500 }); }
}
