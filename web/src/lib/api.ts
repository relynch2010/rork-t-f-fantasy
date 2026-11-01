/**
 * Client for the one TrackDraft server shared with the iOS app. Same accounts, same leagues, same global setup.
 * The server checks every permission; this client never decides who may change what.
 */
export const API_BASE: string = (import.meta.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL as string | undefined)?.replace(/\/$/, "") || "https://trackdraft-backend.rork.app";

const TOKEN_KEY = "td.web.token";
const USER_KEY = "td.web.user";

export type SessionUser = { id: string; name: string; email?: string };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void): void => { onUnauthorized = fn; };

export const session = {
  token: (): string | null => localStorage.getItem(TOKEN_KEY),
  user: (): SessionUser | null => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? "null") as SessionUser | null; } catch { return null; }
  },
  save: (token: string, user: SessionUser): void => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const auth = init.auth !== false;
  if (auth) {
    const t = session.token();
    if (!t) throw new ApiError("Sign in to continue.", 401);
    headers.Authorization = `Bearer ${t}`;
  }
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiError("Can't reach Fantasy T&F. Check your connection.", 0);
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) {
    if (res.status === 401 && auth) onUnauthorized?.();
    throw new ApiError((data && typeof data.error === "string" ? data.error : null) ?? `Something went wrong (${res.status}).`, res.status);
  }
  return data as T;
}

export const absUrl = (p: string | null | undefined): string | null => (p ? (p.startsWith("http") ? p : `${API_BASE}${p}`) : null);

export const avatarUrl = (leagueId: string, teamId: string, v: number | null | undefined): string | null =>
  v ? `${API_BASE}/leagues/${leagueId}/avatar/${teamId}?v=${v}` : null;

export const socketUrl = (leagueId: string): string | null => {
  const t = session.token();
  if (!t) return null;
  return `${API_BASE.replace(/^http/, "ws")}/leagues/${leagueId}/live?token=${encodeURIComponent(t)}`;
};
