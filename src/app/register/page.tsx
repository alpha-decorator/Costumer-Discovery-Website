import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { googleConfigured } from "@/lib/auth/google";
import { safeNext } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Create account — Fieldnotes" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const params = await searchParams;
  return <AuthForm mode="register" googleEnabled={googleConfigured()} next={safeNext(params.next)} initialMode={params.mode === "create" ? "create" : params.mode === "join" ? "join" : "personal"} />;
}
