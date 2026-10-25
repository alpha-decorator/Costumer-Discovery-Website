import { NextResponse } from "next/server";
import { attachSession, requireUser } from "@/lib/auth/server";
import { describeOrg } from "@/lib/org-view";
import { getMembership, removeMember } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A member leaves the organization (the owner cannot; they would have to hand it over first). Their own interviews stay private to them. */
export async function POST(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const membership = await getMembership(user.id);
    if (!membership) return NextResponse.json({ error: "no_org" }, { status: 404 });
    if (membership.role === "owner") return NextResponse.json({ error: "owner_cannot_leave" }, { status: 400 });
    await removeMember(membership.org.id, user.id);
    const reply = NextResponse.json(await describeOrg({ ...user, org: null }));
    return await attachSession(reply, { id: user.id, email: user.email, name: user.name, org: null });
  } catch (error) {
    console.error("Unable to leave organization", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
