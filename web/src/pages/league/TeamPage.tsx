import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowRightLeft, Sparkles, UserMinus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AthleteAvatar, LockBadge, PageHeader, Panel, PosTag, StatusTag, TeamAvatar } from "@/components/td";
import { useLeague } from "@/lib/league";
import { fmtPts, record, SLOT_LABEL, SLOTS, STARTERS, type Athlete, type SlotId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlayerDialog } from "./PlayerDialog";

export default function TeamPage() {
  const { teamId } = useParams();
  const { league, team, athlete, act, busy } = useLeague();
  const t = team(teamId ?? league.me) ?? team(league.me);
  const mine = t?.id === league.me;
  const [moving, setMoving] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const week = league.phase === "season" ? league.week : Math.max(1, league.lastCompletedWeek);
  const flexPos = league.global?.roster.flexPositions ?? ["SPR", "DIS", "FLD"];
  const irStatuses = league.global?.roster.irStatuses ?? ["IR", "O"];

  const fits = useMemo(() => (a: Athlete | undefined, slot: SlotId): boolean => {
    if (!a) return true;
    if (slot === "IR") return !!a.status && irStatuses.includes(a.status);
    if (slot === "FLEX") return a.positions.some((p) => flexPos.includes(p));
    if (slot === "SPR" || slot === "DIS" || slot === "FLD") return a.positions.includes(slot);
    return true;
  }, [flexPos, irStatuses]);

  if (!t) return null;
  const movingAthlete = athlete(moving);
  const fromSlot = moving ? SLOTS.find((s) => t.lineup[s] === moving) : undefined;

  return (
    <div>
      <PageHeader
        eyebrow={`${t.ownerName}${t.coManagerName ? ` & ${t.coManagerName}` : ""}`}
        title={<span className="flex items-center gap-3"><TeamAvatar team={t} leagueId={league.id} size={48} />{t.teamName}</span>}
        sub={<span>{record(t)} • {fmtPts(t.pointsFor)} PF • Rank {t.rank}{league.settings.waiverType === "faab" ? ` • $${t.faab} budget` : ` • Waiver #${t.waiverPriority}`}</span>}
        right={mine && league.phase === "season" ? <Button variant="secondary" className="rounded-full" disabled={busy} onClick={() => act({ type: "optimizeLineup" }, "Lineup optimized")}><Sparkles /> Optimize lineup</Button> : undefined}
      />
      {moving && movingAthlete && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-td-green/40 bg-td-green/10 px-4 py-3 text-sm">
          <span>Moving <b>{movingAthlete.name}</b>. Pick a highlighted spot.</span>
          <Button size="sm" variant="ghost" onClick={() => setMoving(null)}>Cancel</Button>
        </div>
      )}
      <Panel title={`Lineup • Week ${week}`} pad={false}>
        <div className="grid grid-cols-[64px_1fr_auto_auto] items-center gap-x-3 border-b border-border px-4 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-td-faint">
          <span>Spot</span><span>Athlete</span><span className="text-right">Wk pts</span><span className="text-right">Season</span>
        </div>
        {SLOTS.map((slot) => {
          const aid = t.lineup[slot];
          const a = athlete(aid);
          const lock = aid ? league.locks[aid] : undefined;
          const target = !!moving && slot !== fromSlot && fits(movingAthlete, slot) && (!a || (fromSlot ? fits(a, fromSlot) : false)) && !lock;
          const wk = aid ? league.points[aid]?.[String(week)] ?? 0 : 0;
          const season = aid ? Object.values(league.points[aid] ?? {}).reduce((x, y) => x + y, 0) : 0;
          return (
            <div key={slot} className={cn("grid grid-cols-[64px_1fr_auto_auto] items-center gap-x-3 border-b border-border px-4 py-3 last:border-0", STARTERS.includes(slot) ? "" : "bg-black/10", target && "cursor-pointer bg-td-green/10 ring-1 ring-inset ring-td-green/50")}
              onClick={() => { if (target && moving) { act({ type: "moveAthlete", athleteId: moving, slot }); setMoving(null); } }}>
              <span className={cn("num rounded-lg px-2 py-1 text-center text-sm", STARTERS.includes(slot) ? "bg-td-surface2" : "bg-transparent text-td-faint")}>{SLOT_LABEL[slot]}</span>
              {a ? (
                <div className="flex min-w-0 items-center gap-3">
                  <AthleteAvatar athlete={a} size={38} />
                  <div className="min-w-0">
                    <button className="flex items-center gap-2 truncate font-semibold hover:underline" onClick={(e) => { e.stopPropagation(); setCard(a.id); }}>{a.name} <StatusTag status={a.status} /></button>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><PosTag position={a.position} />{a.school}{lock && <LockBadge title={`${lock.event} started ${new Date(lock.at).toLocaleTimeString()}`} />}</div>
                  </div>
                  {mine && league.phase === "season" && !lock && !moving && (
                    <div className="ml-auto flex gap-1">
                      <Button size="icon" variant="ghost" title="Move" onClick={(e) => { e.stopPropagation(); setMoving(a.id); }}><ArrowRightLeft /></Button>
                      <Button size="icon" variant="ghost" title="Drop" onClick={(e) => { e.stopPropagation(); if (confirm(`Drop ${a.name}? They go on waivers.`)) act({ type: "drop", athleteId: a.id }, `${a.name} dropped`); }}><UserMinus /></Button>
                    </div>
                  )}
                </div>
              ) : <span className="text-sm text-td-faint">{target ? "Move here" : "Empty"}</span>}
              <span className="num text-right text-xl">{a ? fmtPts(wk) : ""}</span>
              <span className="num w-16 text-right text-muted-foreground">{a ? fmtPts(season) : ""}</span>
            </div>
          );
        })}
      </Panel>
      <p className="mt-3 text-xs text-muted-foreground">Each player locks when their own first event starts. Locked players can't be moved, benched, dropped or traded until the week is final.</p>
      <PlayerDialog athleteId={card} onClose={() => setCard(null)} />
    </div>
  );
}
