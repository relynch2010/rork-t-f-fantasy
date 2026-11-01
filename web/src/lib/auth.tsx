import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, session, setUnauthorizedHandler, type SessionUser } from "./api";

type AuthResp = { token: string; user: SessionUser; prefs?: Record<string, boolean> };

type AuthValue = {
  user: SessionUser | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => void;
  /** Stores a fresh session issued by the server (e.g. after a password change). */
  refreshSession: (token: string, user: SessionUser) => void;
};

const Ctx = createContext<AuthValue | null>(null);

/** Same accounts as the iOS app: sessions are issued by the shared server. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(session.user());
  const [ready, setReady] = useState<boolean>(false);
  const qc = useQueryClient();

  const apply = useCallback((r: AuthResp) => {
    session.save(r.token, r.user);
    setUser(r.user);
  }, []);

  const signOut = useCallback(() => {
    session.clear();
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    const started = Date.now();
    const finish = (): void => { window.setTimeout(() => setReady(true), Math.max(0, 700 - (Date.now() - started))); };
    if (!session.token()) { finish(); return; }
    api<AuthResp>("/me").then(apply).catch(() => undefined).finally(finish);
  }, [apply, signOut]);

  const value = useMemo<AuthValue>(() => ({
    user, ready, signOut,
    refreshSession: (token, u) => apply({ token, user: u }),
    signIn: async (email, password) => apply(await api<AuthResp>("/auth/login", { body: { email, password }, auth: false })),
    signUp: async (email, password, name) => apply(await api<AuthResp>("/auth/signup", { body: { email, password, name }, auth: false })),
  }), [user, ready, signOut, apply]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
