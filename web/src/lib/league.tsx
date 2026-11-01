import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, socketUrl } from "./api";
import type { Athlete, LeagueState, Team } from "./types";

type LeagueValue = {
  league: LeagueState;
  athlete: (id: string | null | undefined) => Athlete | undefined;
  team: (id: string | null | undefined) => Team | undefined;
  myTeam: Team | undefined;
  isCommish: boolean;
  serverNow: () => number;
  live: boolean;
  /** Runs a league action on the server and shows the confirmed result. Returns false on failure. */
  act: (body: Record<string, unknown>, success?: string) => Promise<boolean>;
  busy: boolean;
  mockSignal: number;
};

const Ctx = createContext<LeagueValue | null>(null);

export const leagueKey = (id: string): string[] => ["league", id];

/** Loads one league and keeps it live over the same websocket the app uses. */
export function LeagueProvider({ id, children, fallback }: { id: string; children: ReactNode; fallback: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [live, setLive] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [mockSignal, setMockSignal] = useState<number>(0);
  const offset = useRef<number>(0);

  const q = useQuery({
    queryKey: leagueKey(id),
    queryFn: () => api<LeagueState>(`/leagues/${id}`),
    refetchInterval: live ? 60_000 : 12_000,
    retry: (n, e) => n < 2 && (e as { status?: number }).status !== 404 && (e as { status?: number }).status !== 403,
  });

  useEffect(() => {
    if (q.data) offset.current = q.data.serverNow - Date.now();
  }, [q.data]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: number | undefined;
    let ping: number | undefined;
    const connect = (): void => {
      const url = socketUrl(id);
      if (!url || closed) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        setLive(true);
        ping = window.setInterval(() => { try { ws?.send("ping"); } catch { /* closed */ } }, 25_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type: string; version?: number };
          if (msg.type === "state") {
            const cur = qc.getQueryData<LeagueState>(leagueKey(id));
            if (!cur || (msg.version ?? 0) > cur.version) qc.invalidateQueries({ queryKey: leagueKey(id) });
            qc.invalidateQueries({ queryKey: ["league-extra", id] });
          } else if (msg.type === "mock") setMockSignal((n) => n + 1);
          else if (msg.type === "deleted") {
            toast.error("This league was deleted.");
            navigate("/");
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        setLive(false);
        window.clearInterval(ping);
        if (!closed) retry = window.setTimeout(connect, 4000);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      window.clearInterval(ping);
      ws?.close();
    };
  }, [id, qc, navigate]);

  const act = useCallback(async (body: Record<string, unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    try {
      const next = await api<LeagueState>(`/leagues/${id}/action`, { body });
      qc.setQueryData(leagueKey(id), next);
      qc.invalidateQueries({ queryKey: ["league-extra", id] });
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [id, qc]);

  const league = q.data;
  const value = useMemo<LeagueValue | null>(() => {
    if (!league) return null;
    const amap = new Map(league.athletes.map((a) => [a.id, a]));
    const tmap = new Map(league.teams.map((t) => [t.id, t]));
    return {
      league,
      athlete: (x) => (x ? amap.get(x) : undefined),
      team: (x) => (x ? tmap.get(x) : undefined),
      myTeam: tmap.get(league.me),
      isCommish: league.commissionerId === league.viewerId,
      serverNow: () => Date.now() + offset.current,
      live, act, busy, mockSignal,
    };
  }, [league, live, act, busy, mockSignal]);

  if (q.error && !league) {
    return (
      <div className="mx-auto max-w-lg p-10 text-center">
        <p className="font-display text-3xl">Couldn't open this league</p>
        <p className="mt-2 text-sm text-muted-foreground">{(q.error as Error).message}</p>
        <button className="mt-6 text-td-green underline" onClick={() => navigate("/")}>Back to my leagues</button>
      </div>
    );
  }
  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLeague(): LeagueValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLeague outside LeagueProvider");
  return v;
}

/** Extra league reads (projections, matchup lines, scoring data) refreshed whenever the league changes. */
export function useLeagueExtra<T>(key: (string | number)[], path: string, enabled = true) {
  const { league } = useLeague();
  return useQuery({
    queryKey: ["league-extra", league.id, ...key, league.version],
    queryFn: () => api<T>(path),
    enabled,
    placeholderData: (prev) => prev,
  });
}
