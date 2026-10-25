import { NextResponse } from "next/server";
import { attachSession, requireUser } from "@/lib/auth/server";
import { moveInterviews } from "@/lib/interviews";
import { describeOrg } from "@/lib/org-view";
import { AlreadyInOrgError, CodeTakenError, createOrg, defaultOrgName, generateCode, getMembership, normalizeCode, updateOrg, validateOrgName, workspaceKey } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
const readBody = async (request: Request) => { try { const body: unknown = await request.json(); return body && typeof body === "object" ? body as Record<string, unknown> : {}; } catch { return {}; } };

/** The signed-in person's organization (if any), its code and its members. */
export async function GET(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try { return NextResponse.json(await describeOrg(user)); }
  catch (error) { console.error("Unable to read organization", error); return fail("server_error", 500); }
}

/** Creates an organization with a generated or a chosen code, makes the caller its owner and moves them into its shared workspace. */
export async function POST(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const body = await readBody(request);
  // The name is optional: people who only want a code get "<their name>'s team", and can rename it later.
  const blank = body.name === undefined || body.name === null || (typeof body.name === "string" && body.name.trim() === "");
  const name = blank ? defaultOrgName(user.name) : validateOrgName(body.name);
  if (!name) return fail("invalid_name", 400);
  const chosen = typeof body.code === "string" && body.code.trim() !== "";
  const wanted = chosen ? normalizeCode(body.code) : null;
  if (chosen && !wanted) return fail("invalid_code", 400);
  try {
    if (await getMembership(user.id)) return fail("already_in_org", 409);
    let org = null;
    for (let attempt = 0; attempt < 6 && !org; attempt++) {
      try { org = await createOrg({ name, code: wanted ?? generateCode(), ownerId: user.id }); }
      catch (error) { if (!(error instanceof CodeTakenError) || chosen) throw error; }
    }
    if (!org) return fail("server_error", 500);
    if (body.shareExisting === true) await moveInterviews(user.id, workspaceKey(org.id), user.id);
    const reply = NextResponse.json(await describeOrg({ ...user, org: org.id }), { status: 201 });
    return await attachSession(reply, { id: user.id, email: user.email, name: user.name, org: org.id });
  } catch (error) {
    if (error instanceof CodeTakenError) return fail("code_taken", 409);
    if (error instanceof AlreadyInOrgError) return fail("already_in_org", 409);
    console.error("Unable to create organization", error);
    return fail("server_error", 500);
  }
}

/** Owner only: rename the organization or change its code (`code: "generate"` picks a fresh random one). */
export async function PATCH(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const body = await readBody(request);
  try {
    const membership = await getMembership(user.id);
    if (!membership) return fail("no_org", 404);
    if (membership.role !== "owner") return fail("owner_only", 403);
    const changes: { name?: string; code?: string } = {};
    if (body.name !== undefined) { const name = validateOrgName(body.name); if (!name) return fail("invalid_name", 400); changes.name = name; }
    if (body.code !== undefined) {
      if (body.code === "generate") changes.code = generateCode();
      else { const code = normalizeCode(body.code); if (!code) return fail("invalid_code", 400); changes.code = code; }
    }
    if (changes.code === undefined && changes.name === undefined) return fail("invalid_input", 400);
    await updateOrg(membership.org.id, changes);
    return NextResponse.json(await describeOrg(user));
  } catch (error) {
    if (error instanceof CodeTakenError) return fail("code_taken", 409);
    console.error("Unable to update organization", error);
    return fail("server_error", 500);
  }
}
