import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Clock, ListOrdered, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AthleteAvatar, PageHeader, Panel, PosTag, TeamAvatar } from "@/components/td";
import { useLeague } from "@/lib/league";
import { waiverScheduleLabel, type Claim } from "@/lib/types";
import { cn } from "@/lib/utils";

const rid = (): string => crypto.randomUUID();

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number): string => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(sec)}`;
}

/** Yahoo-style waivers: next run countdown, my claims in priority order, and the league's waiver priority. */
export default function Waivers() {
  const { league, athlete, team, act, busy, serverNow, myTeam } = useLeague();
  const [now, setNow] = useState<number>(serverNow());
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(t);
  }, [serverNow]);

  const pending = useMemo<Claim[]>(
    () => league.claims.filter((c) => c.status === "pending").sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.createdAt - b.createdAt),
    [league.claims],
  );
  const recent = useMemo<Claim[]>(
    () => league.claims.filter((c) => c.status !== "pending").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 10),
    [league.claims],
  );
  const priority = league.waiverPriorityOrder ?? [...league.teams].sort((a, b) => a.waiverPriority - b.waiverPriority).map((t) => t.id);
  const runAt = league.nextWaiverRun ?? 0;
  const faab = league.settings.waiverType === "faab";

  const move = (i: number, dir: -1 | 1): void => {
    const ids = pending.map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    act({ type: "reorderClaims", claimIds: ids, requestId: rid() }, "Claim order saved");
  };

  return (
    <div>
      <PageHeader eyebrow="Waiver wire" title="Waivers" sub={<span>Processes every {waiverScheduleLabel(league.settings)}. Unclaimed players become free agents.</span>} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Panel>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow flex items-center gap-1.5 text-td-gold"><Clock className="h-3.5 w-3.5" /> Next waiver run</p>
                <p className="pt-1 text-lg font-semibold">{runAt ? new Date(runAt).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not scheduled"}</p>
              </div>
              {runAt > 0 && <p className="font-display text-4xl tabular-nums text-td-green">{countdown(runAt - now)}</p>}
            </div>
            {myTeam && <p className="mt-3 text-sm text-muted-foreground">Your priority: <b className="text-foreground">{faab ? `$${myTeam.faab} budget` : `#${myTeam.waiverPriority} of ${league.teams.length}`}</b>. Claims are due before the run.</p>}
          </Panel>

          <Panel title={`My claims (${pending.length})`} pad={false}>
            {pending.length === 0 && <p className="px-4 py-5 text-sm text-muted-foreground">No pending claims. Open a player on waivers in Players and place a claim.</p>}
            {pending.map((c, i) => {
              const a = athlete(c.addId);
              return (
                <div key={c.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                  <span className="w-5 text-center font-display text-lg text-td-gold">{i + 1}</span>
                  <AthleteAvatar athlete={a} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-semibold">Add {a?.name ?? "player"} {a && <PosTag position={a.position} />}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.dropId ? `Drop ${athlete(c.dropId)?.name ?? "player"}` : "No drop"}{faab ? ` • Bid $${c.bid}` : ""}</p>
                  </div>
                  <Button size="icon" variant="ghost" disabled={busy || i === 0} title="Move up" onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" disabled={busy || i === pending.length - 1} title="Move down" onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button size="icon" variant="ghost" disabled={busy} title="Cancel claim" className="text-td-red" onClick={() => act({ type: "cancelClaim", claimId: c.id, requestId: rid() }, "Claim cancelled")}><X /></Button>
                </div>
              );
            })}
            {pending.length > 1 && <p className="px-4 pb-3 pt-1 text-xs text-muted-foreground">Your claims are tried top to bottom.</p>}
          </Panel>

          {recent.length > 0 && (
            <Panel title="Recent results" pad={false}>
              {recent.map((c) => (
                <div key={c.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                  <AthleteAvatar athlete={athlete(c.addId)} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{athlete(c.addId)?.name ?? "Player"}</p>
                    {c.reason && <p className="truncate text-xs text-muted-foreground">{c.reason}</p>}
                  </div>
                  <span className={cn("text-xs font-black", c.status === "won" ? "text-td-green" : c.status === "lost" ? "text-td-red" : "text-muted-foreground")}>{c.status.toUpperCase()}</span>
                </div>
              ))}
            </Panel>
          )}
        </div>

        <Panel title={<span className="flex items-center gap-2"><ListOrdered className="h-4 w-4" /> Waiver priority</span>} pad={false}>
          {priority.map((id, i) => {
            const t = team(id);
            if (!t) return null;
            return (
              <div key={id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                <span className="w-5 text-center font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                <TeamAvatar team={t} leagueId={league.id} size={28} />
                <span className={cn("truncate text-sm", id === league.me && "font-bold text-td-green")}>{t.teamName}</span>
              </div>
            );
          })}
          <p className="px-4 py-3 text-xs text-muted-foreground">{faab ? "Highest bid wins; ties go to the higher priority." : "Rolling priority starts in reverse draft order. Winning a claim moves you to the bottom."}</p>
        </Panel>
      </div>
    </div>
  );
}
