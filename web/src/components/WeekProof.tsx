import { CheckCircle2, OctagonAlert } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLeague, useLeagueExtra } from "@/lib/league";
import { signed, type BEvent, type TeamBreakdown, type WeekBreakdown } from "@/lib/integrity";
import { cn } from "@/lib/utils";

const ord = (n: number): string => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0]}`; };

export function CheckBar({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold num", ok ? "bg-td-green/10 text-td-green" : "bg-td-red/10 text-td-red")}>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <OctagonAlert className="h-4 w-4" />} {text}
    </div>
  );
}

function EventCard({ e, i }: { e: BEvent; i: number }) {
  const kv: [string, string][] = [
    ["Result ID", e.sourceResultId ?? e.resultId], ["Event ID", e.eventId ?? "—"], ["Round", e.round ?? "—"], ["Heat / flight", e.heat != null ? String(e.heat) : "—"],
    ["Overall place", e.place ? ord(e.place) : "—"], ["Heat / flight place", e.heatPlace ? ord(e.heatPlace) : "—"], ["Field size", e.fieldSize != null ? String(e.fieldSize) : "—"],
    ["Mark", e.mark.original || "—"], ["Normalized", e.mark.value != null ? `${e.mark.value} ${e.mark.unit} · ${e.mark.method}` : "—"], ["Status", e.status],
    ["PB / SB", e.pbsb === "none" ? "Neither" : e.pbsb], ["Seed", e.seedMark || "—"], ["Season tables", e.season ? String(e.season) : "—"], ["Versions", e.lines[0]?.ver || "—"],
  ];
  return (
    <div className="rounded-2xl border border-border bg-td-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div><p className="eyebrow">Event {i}{e.relay ? " · Relay" : ""}{e.provisional ? " · LIVE" : ""}</p><p className="font-display text-2xl">{e.event}</p><p className="text-xs text-muted-foreground">{e.meet} · {e.date}</p></div>
        <span className={cn("num text-3xl", e.total < 0 ? "text-td-red" : "text-td-green")}>{signed(e.total)}</span>
      </div>
      <div className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">{kv.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right font-semibold">{v}</span></div>)}</div>
      <div className="mt-3 divide-y divide-border border-t border-border">
        {e.lines.map((l, j) => (
          <div key={j} className="py-1.5">
            <div className="flex justify-between text-sm"><span>{l.label}</span><span className="num font-semibold">{signed(l.points)}</span></div>
            {l.basis && <p className="text-[11px] text-muted-foreground">{l.basis}</p>}
          </div>
        ))}
      </div>
      {e.corrections.length > 0 && <p className="mt-2 text-xs text-td-gold">{e.corrections.length} earlier official version(s) kept for audit: {e.corrections.map((c) => `${c.status} ${c.mark || "—"}`).join(" → ")}</p>}
    </div>
  );
}

/** Weekly proof: Event 1 + Event 2 + … = weekly total = matchup contribution. */
export function WeekProofDialog({ athleteId, week, onClose }: { athleteId: string | null; week: number; onClose: () => void }) {
  const { league } = useLeague();
  const q = useLeagueExtra<WeekBreakdown>(["proof", athleteId ?? "", week], `/leagues/${league.id}/breakdown?week=${week}&athleteId=${encodeURIComponent(athleteId ?? "")}`, !!athleteId);
  const d = q.data;
  return (
    <Dialog open={!!athleteId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-3xl">{d ? `${d.name} · Week ${d.week} proof` : "Loading…"}</DialogTitle></DialogHeader>
        {d && (
          <div className="space-y-3">
            <CheckBar ok={d.check.ok} text={d.check.text} />
            {d.events.length === 0 && <p className="text-sm text-muted-foreground">No events scored this week.</p>}
            {d.events.map((e, i) => <EventCard key={e.resultId} e={e} i={i + 1} />)}
            <div className="rounded-2xl bg-td-surface2 p-4">
              {d.events.map((e, i) => <div key={e.resultId} className="flex justify-between text-sm"><span>Event {i + 1}: {e.event}</span><span className="num">{signed(e.total)}</span></div>)}
              <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold"><span>Total weekly player score</span><span className="num text-2xl text-td-green">{d.weeklyTotal}</span></div>
              <div className="flex justify-between text-xs text-muted-foreground"><span>Matchup contribution {d.starter ? `· ${d.starter.teamName} (${d.starter.slot})` : "· not a starter"}</span><span className="num">{d.matchupContribution}</span></div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Matchup total traced to every starter's full weekly total. */
export function TeamTraceDialog({ teamId, week, onClose, onAthlete }: { teamId: string | null; week: number; onClose: () => void; onAthlete: (id: string) => void }) {
  const { league } = useLeague();
  const q = useLeagueExtra<TeamBreakdown>(["trace", teamId ?? "", week], `/leagues/${league.id}/breakdown?week=${week}&teamId=${encodeURIComponent(teamId ?? "")}`, !!teamId);
  const d = q.data;
  const rows = (list: TeamBreakdown["starters"], counts: boolean) => list.map((r) => (
    <button key={r.slot} disabled={!r.athleteId} onClick={() => r.athleteId && onAthlete(r.athleteId)} className="block w-full border-b border-border py-2 text-left last:border-0 hover:bg-td-surface2/50 disabled:opacity-50">
      <div className="flex justify-between"><span><span className="mr-3 text-xs font-black text-muted-foreground">{r.slot}</span>{r.name ?? "Empty"}</span><span className={cn("num font-bold", counts ? "text-td-green" : "text-td-faint")}>{r.total}</span></div>
      {r.events.length > 0 && <p className="ml-10 text-xs text-muted-foreground">{r.events.map((e) => `${e.event} ${e.total}`).join(" + ")}</p>}
    </button>
  ));
  return (
    <Dialog open={!!teamId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-3xl">{d?.teamName ?? "Loading…"}</DialogTitle></DialogHeader>
        {d && (
          <div className="space-y-3">
            <CheckBar ok={d.check.ok} text={d.check.text} />
            <p className="eyebrow">Starters (count)</p>{rows(d.starters, true)}
            <p className="eyebrow">Bench (doesn't count)</p>{rows(d.bench, false)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
