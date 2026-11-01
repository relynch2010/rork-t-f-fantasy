import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Search, Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AthleteAvatar, Empty, PageHeader, Panel, PosTag, TeamAvatar } from "@/components/td";
import { useLeague } from "@/lib/league";
import { onClockTeam } from "@/lib/types";
import { cn } from "@/lib/utils";

export function useCountdown(deadline: number | null, serverNow: () => number): number {
  const [left, setLeft] = useState<number>(0);
  useEffect(() => {
    if (!deadline) { setLeft(0); return; }
    const tick = (): void => setLeft(Math.max(0, Math.ceil((deadline - serverNow()) / 1000)));
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [deadline, serverNow]);
  return left;
}

export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function Draft() {
  const { league, team, athlete, act, busy, isCommish, serverNow, myTeam } = useLeague();
  const [q, setQ] = useState<string>("");
  const d = league.draft;
  const onClock = league.phase === "drafting" ? onClockTeam(d.order, d.picks.length) : null;
  const mine = !!onClock && onClock === league.me;
  const left = useCountdown(d.status === "live" ? d.deadline : null, serverNow);
  const taken = useMemo(() => new Set(d.picks.map((p) => p.athleteId)), [d.picks]);
  const order = league.adp.length ? league.adp : league.rankings;
  const avail = useMemo(() => order.map((id) => athlete(id)).filter((a): a is NonNullable<typeof a> => !!a && !taken.has(a.id))
    .filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 150), [order, athlete, taken, q]);

  if (league.phase === "predraft") {
    return (
      <div>
        <PageHeader title="Draft" sub={`${league.teams.length} teams • 6-round snake • ${league.settings.pickSeconds}s per pick`} right={isCommish ? <>
          <Button variant="secondary" className="rounded-full" disabled={busy} onClick={() => act({ type: "randomizeOrder" }, "Draft order set")}><Shuffle /> Randomize order</Button>
          <Button className="rounded-full font-bold" disabled={busy || league.teams.length < 2} onClick={() => confirm("Start the draft now?") && act({ type: "startDraft" }, "The draft is live")}><Play /> Start draft now</Button>
        </> : undefined} />
        <Panel title="Draft order">
          {d.order.length === 0 ? <p className="text-sm text-muted-foreground">{league.settings.draftOrderMode === "random" ? "The order is randomized when the draft starts." : "The commissioner hasn't set the order yet."}</p> : (
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {d.order.map((id, i) => <li key={id} className="flex items-center gap-3 rounded-xl bg-td-surface2 p-2"><span className="num w-6 text-xl text-td-faint">{i + 1}</span><TeamAvatar team={team(id)} leagueId={league.id} size={30} /><span className="truncate font-semibold">{team(id)?.teamName}</span></li>)}
            </ol>
          )}
          <p className="mt-4 text-sm text-muted-foreground">{league.settings.draftAt ? `Scheduled for ${new Date(league.settings.draftAt).toLocaleString()}.` : "No draft time set."}</p>
        </Panel>
      </div>
    );
  }

  const teams = d.order;
  return (
    <div className="space-y-5">
      <div className={cn("panel flex flex-wrap items-center justify-between gap-4 p-5", mine && "border-td-green/60 shadow-[0_0_40px_hsl(var(--td-green)/0.15)]")}>
        <div>
          <p className="eyebrow">{d.status === "done" ? "Draft complete" : `Pick ${d.picks.length + 1} of ${teams.length * d.rounds} • Round ${Math.floor(d.picks.length / Math.max(1, teams.length)) + 1}`}</p>
          <p className={cn("font-display text-4xl", mine && "text-td-green")}>{d.status === "done" ? "Rosters are set" : mine ? "You're on the clock" : `${team(onClock)?.teamName ?? ""} is picking`}</p>
        </div>
        <div className="flex items-center gap-3">
          {d.status === "live" && <span className={cn("num text-5xl", left <= 10 && "text-td-red")}>{clock(left)}</span>}
          {d.status === "paused" && <span className="font-display text-2xl text-td-gold">PAUSED</span>}
          {isCommish && d.status === "live" && <Button variant="secondary" onClick={() => act({ type: "pauseDraft" })}><Pause /> Pause</Button>}
          {isCommish && d.status === "paused" && <Button onClick={() => act({ type: "resumeDraft" })}><Play /> Resume</Button>}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Panel title="Board" pad={false} className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead><tr>{teams.map((id) => <th key={id} className={cn("border-b border-border p-2 text-left font-semibold", id === league.me && "text-td-green")}>{team(id)?.teamName}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: d.rounds }, (_, r) => (
                <tr key={r}>
                  {teams.map((tid, c) => {
                    const idx = r * teams.length + (r % 2 === 0 ? c : teams.length - 1 - c);
                    const p = d.picks[idx];
                    const a = athlete(p?.athleteId);
                    return (
                      <td key={tid} className={cn("border-b border-r border-border p-2 align-top", idx === d.picks.length && d.status !== "done" && "bg-td-green/10")}>
                        {a ? <><p className="truncate font-semibold">{a.name}</p><PosTag position={a.position} /></> : <span className="text-td-faint">{r + 1}.{(r % 2 === 0 ? c : teams.length - 1 - c) + 1}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Available" pad={false}>
          <div className="relative p-3">
            <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-9" />
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {avail.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-t border-border px-3 py-2">
                <AthleteAvatar athlete={a} size={32} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{a.name}</p><PosTag position={a.position} /></div>
                {mine && d.status === "live" && <Button size="sm" className="font-bold" disabled={busy} onClick={() => act({ type: "pick", athleteId: a.id, pickNumber: d.picks.length + 1 }, `Drafted ${a.name}`)}>Draft</Button>}
                {!mine && myTeam && d.status !== "done" && (
                  <Button size="sm" variant="ghost" onClick={() => act({ type: "setQueue", ids: myTeam.queue.includes(a.id) ? myTeam.queue.filter((x) => x !== a.id) : [...myTeam.queue, a.id] })}>{myTeam.queue.includes(a.id) ? "Queued" : "Queue"}</Button>
                )}
              </div>
            ))}
            {avail.length === 0 && <Empty title="Nobody left" />}
          </div>
        </Panel>
      </div>
    </div>
  );
}
