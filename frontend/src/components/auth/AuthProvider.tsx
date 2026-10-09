"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AUTH_EXPIRED_EVENT, clearToken, getToken, setToken } from "@/lib/auth";
import type { AuthUser } from "@/lib/types";

type Status = "loading" | "authed" | "anon";

interface AuthContextValue {
  user: AuthUser | null;
  status: Status;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (name: string, email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // On first load: if we hold a token, ask the server who it belongs to.
  useEffect(() => {
    let alive = true;
    if (!getToken()) {
      setStatus("anon");
      return;
    }
    api
      .me()
      .then((u) => alive && (setUser(u), setStatus("authed")))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) clearToken(); // expired / invalid
        setStatus("anon");
      });
    return () => {
      alive = false;
    };
  }, []);

  // The API layer tells us when any request comes back 401.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setStatus("anon");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const accept = useCallback((res: { token: string; user: AuthUser }) => {
    setToken(res.token);
    setUser(res.user);
    setStatus("authed");
    return res.user;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login: async (email, password) => accept(await api.login(email, password)),
      signup: async (name, email, password) => accept(await api.signup(name, email, password)),
      logout: () => {
        clearToken();
        setUser(null);
        setStatus("anon");
      },
    }),
    [user, status, accept],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
