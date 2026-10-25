import { NextResponse } from "next/server";
import { attachSession, requireUser } from "@/lib/auth/server";
import { describeOrg } from "@/lib/org-view";
import { getMembership } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Move between the person's own interviews and their organization's shared ones. Always allowed to go back to personal. */
export async function POST(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  let body: { workspace?: unknown } = {};
  try { body = await request.json() as { workspace?: unknown }; } catch { /* handled below */ }
  if (body?.workspace !== "org" && body?.workspace !== "personal") return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    let orgId: string | null = null;
    if (body.workspace === "org") {
      const membership = await getMembership(user.id);
      if (!membership) return NextResponse.json({ error: "no_org" }, { status: 404 });
      orgId = membership.org.id;
    }
    const reply = NextResponse.json(await describeOrg({ ...user, org: orgId }));
    return await attachSession(reply, { id: user.id, email: user.email, name: user.name, org: orgId });
  } catch (error) {
    console.error("Unable to switch workspace", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
