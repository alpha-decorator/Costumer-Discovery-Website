"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/session";

type AuthValue = { user: SessionUser | null; signOut: () => Promise<void> };

const AuthContext = createContext<AuthValue | null>(null);

/** `user` is read from the signed session cookie on the server (see layout.tsx). */
export function AuthProvider({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  const signOut = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    finally { window.location.assign("/login"); }
  }, []);
  const value = useMemo(() => ({ user, signOut }), [user, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}
