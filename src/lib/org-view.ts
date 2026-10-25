import { countInterviews } from "./interviews";
import { getMembership, listMembers, type Member, type Role } from "./orgs";
import type { SessionUser } from "./auth/session";

export type OrgView = {
  /** The signed-in person's own user id, so the member list can mark "you". */
  you: string;
  /** Which set of interviews this session is working in right now. */
  workspace: "personal" | "org";
  org: { id: string; name: string; code: string; role: Role; members: Member[] } | null;
  /** How many interviews sit in the person's own workspace (offered to the organization when they create one). */
  personalInterviews: number;
};

/** What the business-code panel needs. The code is shown to every member so colleagues can invite each other; only the owner can change it. */
export async function describeOrg(user: SessionUser): Promise<OrgView> {
  const membership = await getMembership(user.id);
  const personalInterviews = await countInterviews(user.id);
  if (!membership) return { you: user.id, workspace: "personal", org: null, personalInterviews };
  const members = await listMembers(membership.org.id);
  return {
    you: user.id,
    workspace: user.org && user.org === membership.org.id ? "org" : "personal",
    org: { id: membership.org.id, name: membership.org.name, code: membership.org.code, role: membership.role, members },
    personalInterviews,
  };
}
