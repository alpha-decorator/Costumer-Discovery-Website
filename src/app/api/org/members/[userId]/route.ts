import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { describeOrg } from "@/lib/org-view";
import { getMembership, removeMember } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner only: remove a colleague. They lose access to the shared interviews at once (every request re-checks membership). */
export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const membership = await getMembership(user.id);
    if (!membership) return NextResponse.json({ error: "no_org" }, { status: 404 });
    if (membership.role !== "owner") return NextResponse.json({ error: "owner_only" }, { status: 403 });
    const { userId } = await context.params;
    if (!(await removeMember(membership.org.id, userId))) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json(await describeOrg(user));
  } catch (error) {
    console.error("Unable to remove member", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
