import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AthleteAvatar, LiveDot, LockBadge, Panel, PosTag, TeamAvatar } from "@/components/td";
import { useLeague, useLeagueExtra } from "@/lib/league";
import { fmtPts, record, SLOT_LABEL, SLOTS, STARTERS, weekLabel, type ScoreLine, type SlotId, type WeekProjections } from "@/lib/types";
import { PlayerDialog } from "./PlayerDialog";
import { TeamTraceDialog, WeekProofDialog } from "@/components/WeekProof";

export default function MatchupPage() {
  const { league, team, athlete } = useLeague();
  const [params] = useSearchParams();
  const focusId = params.get("team") ?? league.me;
  const [week, setWeek] = useState<number>(Number(params.get("week")) || (league.phase === "season" ? league.week : Math.max(1, league.lastCompletedWeek)));
  const [card, setCard] = useState<string | null>(null);
  const [trace, setTrace] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const m = league.schedule.find((x) => x.week === week && (x.homeId === focusId || x.awayId === focusId));
  const leftId = m ? (m.homeId === focusId ? m.homeId : m.awayId) : focusId;
  const rightId = m ? (m.homeId === focusId ? m.awayId : m.homeId) : null;
  const proj = useLeagueExtra<WeekProjections>(["proj", week], `/leagues/${league.id}/projections?week=${week}`, league.phase !== "predraft");
  const lines = useLeagueExtra<{ lines: ScoreLine[]; teamIds: string[] }>(["mlines", week, focusId], `/leagues/${league.id}/matchup?week=${week}&teamId=${focusId}`, league.phase !== "predraft");
  const live = league.meets.some((x) => x.week === week && x.status === "LIVE" && !x.archived);
  const pm = proj.data?.matchups.find((x) => x.id === m?.id);
  const leftWin = pm ? (m?.homeId === leftId ? pm.winHome : pm.winAway) : null;

  const ptsBy = useMemo(() => {
    const out = new Map<string, number>();
    for (const l of lines.data?.lines ?? []) out.set(l.athleteId, (out.get(l.athleteId) ?? 0) + l.points);
    return out;
  }, [lines.data]);

  const lineupFor = (tid: string | null): Record<SlotId, string | null> | null => {
    if (!tid) return null;
    const t = team(tid);
    return t?.lineup ?? null;
  };
  const score = (tid: string | null): number => (!m || !tid ? 0 : tid === m.homeId ? m.homeScore : m.awayScore ?? 0);
  const L = lineupFor(leftId);
  const R = lineupFor(rightId);
  const maxWeek = Math.max(1, league.totalWeeks);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" disabled={week <= 1} onClick={() => setWeek(week - 1)}><ChevronLeft /></Button>
        <p className="font-display text-2xl">{weekLabel(league, week)}{m?.final ? " • Final" : ""}</p>
        <Button variant="ghost" size="icon" disabled={week >= maxWeek} onClick={() => setWeek(week + 1)}><ChevronRight /></Button>
      </div>
      <div className="panel lane-lines p-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
          <Side tid={leftId} align="left" />
          <div className="text-center">
            <div className="num flex items-baseline justify-center gap-3 text-6xl">
              <span className={score(leftId) >= score(rightId) ? "text-td-green" : ""}>{fmtPts(score(leftId))}</span>
              <span className="text-2xl text-td-faint">–</span>
              <span className={score(rightId) > score(leftId) ? "text-td-green" : ""}>{fmtPts(score(rightId))}</span>
            </div>
            {live && <p className="mt-1 flex items-center justify-center gap-1.5 text-xs font-black text-td-red"><LiveDot /> LIVE</p>}
          </div>
          <Side tid={rightId} align="right" />
        </div>
        {pm && leftWin !== null && !m?.final && (
          <div className="mt-6">
            <div className="flex justify-between text-xs font-bold text-muted-foreground">
              <span>Win {Math.round(leftWin)}%</span>
              <span>Projected {fmtPts(proj.data?.teams[leftId ?? ""]?.total)} – {fmtPts(proj.data?.teams[rightId ?? ""]?.total)}{proj.data?.stale ? " • live source delayed" : ""}</span>
              <span>{Math.round(100 - leftWin)}% Win</span>
            </div>
            <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-td-surface2">
              <div className="bg-td-green transition-all duration-700" style={{ width: `${leftWin}%` }} />
              <div className="flex-1 bg-td-red/70" />
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {leftId && <Button size="sm" variant="outline" onClick={() => setTrace(leftId)}>Trace {team(leftId)?.teamName ?? ""} total</Button>}
        {rightId && <Button size="sm" variant="outline" onClick={() => setTrace(rightId)}>Trace {team(rightId)?.teamName ?? ""} total</Button>}
      </div>
      <Panel pad={false}>
        {SLOTS.map((slot) => {
          const a = athlete(L?.[slot]);
          const b = athlete(R?.[slot]);
          const starter = STARTERS.includes(slot);
          return (
            <div key={slot} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border px-4 py-3 last:border-0 ${starter ? "" : "bg-black/10 opacity-80"}`}>
              <Row a={a} pts={a ? ptsBy.get(a.id) ?? 0 : 0} projPts={a ? proj.data?.athletes[a.id]?.projected : undefined} locked={!!(a && league.locks[a.id])} onOpen={setCard} />
              <span className="num w-12 rounded-lg bg-td-surface2 py-1 text-center text-sm">{SLOT_LABEL[slot]}</span>
              <Row a={b} pts={b ? ptsBy.get(b.id) ?? 0 : 0} projPts={b ? proj.data?.athletes[b.id]?.projected : undefined} locked={!!(b && league.locks[b.id])} onOpen={setCard} right />
            </div>
          );
        })}
      </Panel>
      <PlayerDialog athleteId={card} onClose={() => setCard(null)} />
      <TeamTraceDialog teamId={trace} week={week} onClose={() => setTrace(null)} onAthlete={(id) => { setTrace(null); setProof(id); }} />
      <WeekProofDialog athleteId={proof} week={week} onClose={() => setProof(null)} />
    </div>
  );

  function Side({ tid, align }: { tid: string | null; align: "left" | "right" }) {
    const t = team(tid);
    return (
      <div className={`flex items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <TeamAvatar team={t} leagueId={league.id} size={60} />
        <div className="min-w-0"><p className="font-display truncate text-2xl">{t?.teamName ?? "Bye"}</p><p className="text-xs text-muted-foreground">{t ? `${record(t)} • ${t.ownerName}` : ""}</p></div>
      </div>
    );
  }
}

function Row({ a, pts, projPts, locked, onOpen, right }: { a?: import("@/lib/types").Athlete; pts: number; projPts?: number; locked: boolean; onOpen: (id: string) => void; right?: boolean }) {
  if (!a) return <span className={`text-sm text-td-faint ${right ? "text-right" : ""}`}>Empty</span>;
  return (
    <div className={`flex min-w-0 items-center gap-3 ${right ? "flex-row-reverse text-right" : ""}`}>
      <AthleteAvatar athlete={a} size={36} />
      <div className="min-w-0 flex-1">
        <button onClick={() => onOpen(a.id)} className="truncate font-semibold hover:underline">{a.name}</button>
        <div className={`flex items-center gap-2 text-xs text-muted-foreground ${right ? "justify-end" : ""}`}><PosTag position={a.position} />{locked && <LockBadge />}{projPts !== undefined && <span>Proj {fmtPts(projPts)}</span>}</div>
      </div>
      <span className="num text-2xl">{fmtPts(pts)}</span>
    </div>
  );
}
