import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Lock, Shuffle, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Panel } from "@/components/td";
import { api } from "@/lib/api";
import { useLeague } from "@/lib/league";

type Game = { id: string; week: number; homeId: string; awayId: string | null; final: boolean; kind: string; round: string | null; locked?: boolean };
type Checks = { ok: boolean; problems: string[]; checks: { name: string; ok: boolean; detail: string }[]; byes: Record<string, number> };
type ScheduleBody = {
  teams: { id: string; name: string }[]; regularWeeks: number; playoffTeams: number; totalWeeks: number; currentWeek: number; firstEditableWeek: number;
  phase: string; advanceAt: number | null; rhythm: string[]; schedule: Game[]; checks: Checks;
  preview: { seed: number; schedule: Game[]; checks: Checks; changedGames: number } | null;
  log: { at: number; by: string; action: string; detail: string; fromWeek: number }[];
};

function CheckList({ c }: { c: Checks }) {
  return (
    <ul className="space-y-1.5">
      {c.checks.map((k) => (
        <li key={k.name} className="flex items-start gap-2 text-sm">
          {k.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-td-green" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-td-gold" />}
          <span>{k.name}<span className="block text-xs text-muted-foreground">{k.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

/** Commissioner season schedule: same authoritative schedule as the iPhone; changes need confirmation and are logged. */
export default function Schedule() {
  const { league, act, busy, isCommish } = useLeague();
  const qc = useQueryClient();
  const [seed, setSeed] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ week: number; pairs: (string | null)[][] } | null>(null);
  const q = useQuery({
    queryKey: ["schedule", league.id, league.version, seed],
    queryFn: () => api<ScheduleBody>(`/leagues/${league.id}/tools`, { body: { op: "schedule", ...(seed ? { seed } : {}) } }),
    enabled: isCommish,
  });
  if (!isCommish) return <Empty title="Commissioner only" />;
  const s = q.data;
  const name = (id: string | null): string => (id ? s?.teams.find((t) => t.id === id)?.name ?? "Team" : "BYE");
  const weeks = s ? [...new Set(s.schedule.map((g) => g.week))].sort((a, b) => a - b) : [];
  const editValid = edit && s ? (() => {
    const ids = edit.pairs.flat().filter((x): x is string => !!x);
    return new Set(ids).size === ids.length && ids.length === s.teams.length && edit.pairs.every((p) => !!p[0]);
  })() : false;

  return (
    <div>
      <PageHeader title="Season Schedule" sub="Every team sees this same schedule. Completed and started weeks never change." />
      {!s ? <p className="text-sm text-muted-foreground">{q.isLoading ? "Loading…" : "Couldn't load the schedule."}</p> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {weeks.map((w) => {
              const games = s.schedule.filter((g) => g.week === w);
              const locked = games.every((g) => g.locked ?? true);
              return (
                <Panel key={w} title={`${games[0]?.round ?? `Week ${w}`}${w === s.currentWeek ? " · current" : ""}`} right={locked ? <span className="flex items-center gap-1 text-xs text-td-faint"><Lock className="h-3 w-3" />{games.every((g) => g.final) ? "Final" : "Locked"}</span> : games[0]?.kind === "regular" ? <Button size="sm" variant="ghost" onClick={() => setEdit({ week: w, pairs: games.filter((g) => g.kind === "regular").map((g) => [g.homeId, g.awayId]) })}>Edit</Button> : undefined}>
                  <div className="space-y-1">
                    {games.map((g) => <div key={g.id} className="flex justify-between text-sm"><span>{name(g.homeId)}</span><span className="text-xs font-black text-td-faint">{g.awayId ? "vs" : "BYE"}</span><span>{g.awayId ? name(g.awayId) : ""}</span></div>)}
                  </div>
                  {edit?.week === w && (
                    <div className="mt-3 space-y-2 rounded-xl bg-td-surface2 p-3">
                      {edit.pairs.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          {[0, 1].map((side) => (
                            <select key={side} className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={p[side] ?? ""} onChange={(e) => { const next = edit.pairs.map((x) => [...x]); next[i][side] = e.target.value || null; setEdit({ ...edit, pairs: next }); }}>
                              {side === 1 && <option value="">BYE</option>}
                              {s.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          ))}
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">{editValid ? "Every team appears exactly once." : "Each team must appear exactly once."}</p>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={!editValid || busy} onClick={async () => { if (confirm(`Change Week ${w}? Every manager is notified and it's logged.`) && await act({ type: "setWeekSchedule", week: w, pairs: edit.pairs, confirm: true }, `Week ${w} updated`)) { setEdit(null); qc.invalidateQueries({ queryKey: ["schedule"] }); } }}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </Panel>
              );
            })}
          </div>
          <div className="space-y-4">
            <Panel title="Weekly rhythm · Eastern">
              <ul className="space-y-1 text-xs text-muted-foreground">{s.rhythm.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="mt-2 text-sm font-semibold">{s.teams.length} teams · {s.regularWeeks} regular weeks · {s.playoffTeams}-team playoff</p>
              {s.advanceAt && <p className="mt-1 text-xs text-td-green">Week {s.currentWeek} is final. Week {s.currentWeek + 1} activates {new Date(s.advanceAt).toLocaleString()}.</p>}
            </Panel>
            <Panel title="Checks"><CheckList c={s.checks} /></Panel>
            <Panel title="Regenerate open weeks">
              <p className="mb-3 text-xs text-muted-foreground">{s.firstEditableWeek > s.regularWeeks ? "Every regular week has started. The schedule is locked." : `Weeks ${s.firstEditableWeek}–${s.regularWeeks} can change. Earlier weeks stay exactly as they are.`}</p>
              {s.firstEditableWeek <= s.regularWeeks && <Button variant="secondary" onClick={() => setSeed(Math.floor(Math.random() * 999_999) + 1)}><Shuffle /> Preview new rotation</Button>}
              {s.preview && (
                <div className="mt-3 space-y-3 rounded-xl border border-td-gold/40 p-3">
                  <p className="text-xs font-black tracking-wider text-td-gold">PREVIEW · NOT SAVED · {s.preview.changedGames} games change</p>
                  <CheckList c={s.preview.checks} />
                  <div className="max-h-60 space-y-2 overflow-y-auto text-xs">
                    {[...new Set(s.preview.schedule.filter((g) => g.kind === "regular" && g.week >= s.firstEditableWeek).map((g) => g.week))].map((w) => (
                      <div key={w}><b>Week {w}</b>{s.preview?.schedule.filter((g) => g.week === w && g.kind === "regular").map((g) => <div key={g.id}>{name(g.homeId)} vs {name(g.awayId)}</div>)}</div>
                    ))}
                  </div>
                  <Button disabled={busy || !s.preview.checks.checks.slice(0, 3).every((c) => c.ok)} onClick={async () => { if (confirm("Replace the open weeks with this schedule? Completed weeks stay unchanged.") && await act({ type: "regenerateSchedule", seed: s.preview?.seed, confirm: true }, "Schedule updated")) setSeed(null); }}>Use this schedule</Button>
                </div>
              )}
            </Panel>
            {s.log.length > 0 && (
              <Panel title="Change history">
                <ul className="space-y-2 text-xs">{s.log.map((l) => <li key={l.at}>{l.detail}<span className="block text-td-faint">{l.by} · {new Date(l.at).toLocaleString()}</span></li>)}</ul>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
