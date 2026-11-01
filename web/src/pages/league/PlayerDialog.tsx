import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AthleteAvatar, PosTag, StatusTag } from "@/components/td";
import { useLeague, useLeagueExtra } from "@/lib/league";
import { fmtPts, type ScoreLine } from "@/lib/types";
import { WeekProofDialog } from "@/components/WeekProof";

/** Player card: season points, every scoring line from the server engine, and add/drop/claim. */
export function PlayerDialog({ athleteId, onClose }: { athleteId: string | null; onClose: () => void }) {
  const { league, athlete, team, myTeam, act, busy, isCommish } = useLeague();
  const a = athlete(athleteId);
  const lines = useLeagueExtra<{ lines: ScoreLine[] }>(["athlete", athleteId ?? ""], `/leagues/${league.id}/athlete?athleteId=${encodeURIComponent(athleteId ?? "")}`, !!athleteId);
  const [dropId, setDropId] = useState<string>("");
  const [bid, setBid] = useState<number>(0);
  const [proofWeek, setProofWeek] = useState<number | null>(null);
  if (!a) return null;
  const owner = league.teams.find((t) => t.roster.includes(a.id));
  const onWaivers = !!league.waivers[a.id];
  const season = Object.values(league.points[a.id] ?? {}).reduce((x, y) => x + y, 0);
  const byWeek = new Map<number, ScoreLine[]>();
  for (const l of lines.data?.lines ?? []) byWeek.set(l.week, [...(byWeek.get(l.week) ?? []), l]);
  const canAdd = league.phase === "season" && !owner && !!myTeam;

  const add = async (): Promise<void> => {
    const ok = onWaivers
      ? await act({ type: "claim", addId: a.id, dropId: dropId || null, bid }, "Waiver claim placed")
      : await act({ type: "addDrop", addId: a.id, dropId: dropId || null }, `${a.name} added`);
    if (ok) onClose();
  };

  return (
    <Dialog open={!!athleteId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <AthleteAvatar athlete={a} size={64} />
            <div className="text-left">
              <p className="font-display text-4xl leading-none">{a.name} <StatusTag status={a.status} /></p>
              <p className="mt-1 flex items-center gap-2 text-sm font-normal text-muted-foreground"><PosTag position={a.position} />{a.gender === "G" ? "Girls" : "Boys"}{a.school ? ` • ${a.school}` : ""}</p>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-td-surface2 p-3"><p className="eyebrow">Season pts</p><p className="num text-3xl text-td-green">{fmtPts(season)}</p></div>
          <div className="rounded-xl bg-td-surface2 p-3"><p className="eyebrow">Rank</p><p className="num text-3xl">#{league.rankings.indexOf(a.id) + 1}</p></div>
          <div className="rounded-xl bg-td-surface2 p-3"><p className="eyebrow">Team</p><p className="truncate pt-1 font-semibold">{owner?.teamName ?? (onWaivers ? "Waivers" : "Free agent")}</p></div>
        </div>
        {(league.reviewFlags?.[a.id] ?? 0) > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-td-gold/10 p-3 text-xs text-muted-foreground">
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-td-gold text-[10px] font-black text-black">?</span>
            Needs review: a possible result for this player is waiting for the commissioner. It earns nothing until confirmed and is never assigned automatically.
          </div>
        )}
        {canAdd && (
          <div className={`rounded-xl border p-3 ${onWaivers ? "border-td-waiver/50" : "border-td-green/50"}`}>
            <p className={`mb-2 text-sm font-semibold ${onWaivers ? "text-td-waiver" : "text-td-green"}`}>{onWaivers ? `On waivers · place a claim (processes ${league.waivers[a.id] ? new Date(league.waivers[a.id]).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "at the next run"})` : "Free agent · add now"}</p>
            <div className="flex flex-wrap gap-2">
              <select className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={dropId} onChange={(e) => setDropId(e.target.value)}>
                <option value="">Drop nobody</option>
                {myTeam!.roster.map((id) => <option key={id} value={id}>Drop {athlete(id)?.name}</option>)}
              </select>
              {onWaivers && league.settings.waiverType === "faab" && <Input type="number" min={0} max={myTeam!.faab} value={bid} onChange={(e) => setBid(Number(e.target.value))} className="w-24" />}
              <Button disabled={busy} onClick={add} className={`font-bold ${onWaivers ? "bg-td-waiver text-black hover:bg-td-waiver/90" : ""}`}>{onWaivers ? "Claim" : "Add"}</Button>
            </div>
          </div>
        )}
        {isCommish && !(league.canEditPlayers ?? true) && (
          <p className="text-xs text-td-faint">Photo, positions and status are set by the Main League.</p>
        )}
        {isCommish && (league.canEditPlayers ?? true) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            {(["active", "Q", "O", "IR"] as const).map((s) => (
              <Button key={s} size="sm" variant={(a.status ?? "active") === s ? "default" : "secondary"} onClick={() => act({ type: "setStatus", athleteId: a.id, status: s }, "Status updated")}>{s === "active" ? "Active" : s}</Button>
            ))}
          </div>
        )}
        <div>
          <p className="eyebrow mb-2">Scoring breakdown</p>
          {lines.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : byWeek.size === 0 ? <p className="text-sm text-muted-foreground">No fantasy points yet.</p> : (
            <div className="space-y-3">
              {[...byWeek.entries()].sort((x, y) => y[0] - x[0]).map(([w, ls]) => (
                <div key={w} className="rounded-xl bg-td-surface2 p-3">
                  <div className="mb-1 flex justify-between text-sm font-bold"><span>Week {w} <button className="ml-2 text-xs font-semibold text-td-green underline" onClick={() => setProofWeek(w)}>Proof: every event + total</button></span><span className="num text-lg">{fmtPts(ls.reduce((s, l) => s + l.points, 0))}</span></div>
                  {ls.map((l) => (
                    <div key={l.id} className="flex justify-between gap-3 py-0.5 text-sm">
                      <span className="text-muted-foreground">{l.event} • {l.label}{l.provisional ? " (live)" : ""}</span>
                      <span className={`num ${l.points < 0 ? "text-td-red" : "text-td-green"}`}>{l.points > 0 ? "+" : ""}{l.points}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {owner && owner.id !== league.me && league.phase === "season" && (
          <p className="text-xs text-muted-foreground">Owned by {team(owner.id)?.teamName}. Propose a trade from Activity.</p>
        )}
      </DialogContent>
    <WeekProofDialog athleteId={proofWeek !== null ? a.id : null} week={proofWeek ?? 1} onClose={() => setProofWeek(null)} />
    </Dialog>
  );
}

export const toastErr = (e: unknown): void => { toast.error((e as Error).message); };
