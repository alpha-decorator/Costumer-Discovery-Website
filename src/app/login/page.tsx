import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { googleConfigured } from "@/lib/auth/google";
import { safeNext } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in — Fieldnotes" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; tab?: string }> }) {
  const params = await searchParams;
  return <AuthForm mode="login" googleEnabled={googleConfigured()} next={safeNext(params.next)} urlError={params.error} initialTab={params.tab === "institution" ? "institution" : "personal"} />;
}
