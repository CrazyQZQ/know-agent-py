import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiError, setUnauthorizedHandler } from "@/lib/api-client";
import { login as loginRequest, logout as logoutRequest, type AuthState } from "./auth-api";

const STORAGE_KEY = "know-agent.auth";

export type AuthContextValue = {
  auth: AuthState | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredAuth(): AuthState | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as AuthState;
    if (!parsed?.token || !parsed.user?.name || !Array.isArray(parsed.user.roles)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(() => readStoredAuth());

  const clear = useCallback(() => {
    setAuth(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* unavailable storage */ }
  }, []);

  useEffect(() => setUnauthorizedHandler(clear), [clear]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const next = await loginRequest(username, password);
      setAuth(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clear();
      throw error;
    }
  }, [clear]);

  const logout = useCallback(async () => {
    const current = auth;
    clear();
    if (!current) return;
    try { await logoutRequest(current.token); } catch { /* local logout remains complete */ }
  }, [auth, clear]);

  const value = useMemo(() => ({ auth, login, logout }), [auth, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
