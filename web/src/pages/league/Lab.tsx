import { useMemo, useState } from "react";
import { FlaskConical, Loader2, Lock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MainLeagueBanner, PageHeader, Panel } from "@/components/td";
import { LabSummary, verdictOf, type LabEvidence, type LabResult, type LabVerdict } from "@/components/LabSummary";
import { api } from "@/lib/api";
import { useLeague } from "@/lib/league";
import { cn } from "@/lib/utils";

const ord = (n: number): string => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0]}`;
};

const MATCHED = new Set(["source_id", "mapping", "name_cornwall", "relay_members"]);

/** Main League commissioner: replays a past AthleticLIVE meet through the production pipeline, isolated from every league. */
export default function Lab() {
  const { league } = useLeague();
  const [url, setUrl] = useState<string>("");
  const [repeat, setRepeat] = useState<boolean>(true);
  const [reconcile, setReconcile] = useState<boolean>(true);
  const [fault, setFault] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<LabResult | null>(null);
  const [filter, setFilter] = useState<"cornwall" | "matched" | "review">("cornwall");
  const [open, setOpen] = useState<LabEvidence | null>(null);

  const evidence = useMemo(() => {
    const list = result?.evidence ?? [];
    if (filter === "matched") return list.filter((e) => MATCHED.has(e.match.type));
    if (filter === "review") return list.filter((e) => ["review", "conflict", "none"].includes(e.match.type));
    return list;
  }, [result, filter]);

  if (!league.canEditGlobal) {
    return <div><PageHeader title="Meet Test Lab" /><MainLeagueBanner>The Meet Test Lab is for the Main League commissioner.</MainLeagueBanner></div>;
  }

  const run = async (): Promise<void> => {
    setRunning(true); setResult(null);
    try {
      setResult(await api<LabResult>(`/leagues/${league.id}/meet-lab`, {
        body: { provider: "ATHLETICLIVE", sourceUrl: url.trim(), repeat, reconcile, week: league.week, ...(fault ? { fault } : {}) },
      }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const tests: [string, LabVerdict | undefined][] = [["Repeat import ×3", result?.repeat], ["Live → final", result?.reconcile], ["Failure handling", result?.fault]];
  const c = result?.counts;

  return (
    <div>
      <PageHeader title="Meet Test Lab" sub="Replay a past AthleticLIVE meet through the same import, matching and scoring as live meets. Standings, rosters, matchups, waivers, trades and point totals are never touched." />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <Panel title="Past meet">
            <div className="space-y-3">
              <Input className="font-mono" placeholder="https://live.athletic.net/meets/…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repeat import ×3</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reconcile} onChange={(e) => setReconcile(e.target.checked)} /> Live → final check</label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={fault} onChange={(e) => setFault(e.target.value)}>
                <option value="">No simulated failure</option>
                <option value="timeout">Simulate timeout</option>
                <option value="5xx">Simulate server error (5xx)</option>
                <option value="empty">Simulate empty response</option>
                <option value="incomplete">Simulate incomplete results</option>
              </select>
              <Button className="w-full font-bold" disabled={running || !url.trim()} onClick={run}>{running ? <Loader2 className="animate-spin" /> : <FlaskConical />} Run test</Button>
            </div>
          </Panel>
          {result && <LabSummary result={result} />}
          {result?.isolation && (
            <p className={cn("flex items-center gap-2 rounded-xl p-3 text-sm font-semibold", result.isolation.unchanged ? "bg-td-green/10 text-td-green" : "bg-td-red/10 text-td-red")}>
              {result.isolation.unchanged ? <Lock className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              {result.isolation.unchanged ? "League data unchanged after the test" : "League data changed. Report this."}
            </p>
          )}
          {tests.some(([, v]) => v) && (
            <Panel title="Acceptance tests">
              <ul className="space-y-2">
                {tests.filter(([, v]) => v).map(([name, v]) => (
                  <li key={name} className="text-sm">
                    <p className={cn("font-semibold", v?.verdict?.startsWith("PASS") ? "text-td-green" : "text-td-red")}>{name}</p>
                    <p className="text-xs text-muted-foreground">{v?.verdict}</p>
                    {v?.message && <p className="text-xs text-td-faint">{v.message}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {c && (
            <Panel title="Import counts" pad={false}>
              {([
                ["Events", c.events], ["Athletes (every school)", c.athletes], ["Results", c.results], ["Cornwall Central athletes", c.cornwall],
                ["Matched to master players", c.matched], ["Needs review", c.review], ["Source ID conflicts", c.conflicts], ["Not in player database", c.unmatched],
                ["Documents refused (other meet)", c.rejected], ["Duplicates prevented", c.duplicatesPrevented], ["Fantasy points", c.points],
              ] as [string, number | undefined][]).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-border px-4 py-2 text-sm last:border-0"><span className="text-muted-foreground">{k}</span><span className="num text-lg">{v ?? 0}</span></div>
              ))}
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          {result && (result.evidence?.length ?? 0) > 0 && (
            <Panel title="Athlete evidence" right={
              <div className="flex gap-1">
                {(["cornwall", "matched", "review"] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", filter === f ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground")}>{f === "cornwall" ? "Cornwall" : f === "matched" ? "Matched" : "Review"}</button>
                ))}
              </div>
            } pad={false}>
              <div className="max-h-[720px] overflow-y-auto">
                {evidence.map((e, i) => (
                  <button key={i} onClick={() => setOpen(e)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-0 hover:bg-td-surface2/60">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-semibold">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", MATCHED.has(e.match.type) ? "bg-td-green" : e.match.type === "conflict" ? "bg-td-red" : e.match.type === "review" ? "bg-td-gold" : "bg-td-faint")} />
                        {e.source.name}{e.master && e.master.name !== e.source.name ? <span className="text-xs text-muted-foreground">→ {e.master.name}</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{e.result.sourceEvent}</p>
                      <p className="text-xs text-td-faint">{[e.result.status !== "OK" ? e.result.status : e.result.mark, e.result.place ? `${ord(e.result.place)} overall` : "", e.result.heatPlace ? `${ord(e.result.heatPlace)} in ${e.result.type === "field" ? "flight" : "heat"} ${e.result.heat}` : "", e.result.fieldSize ? `field ${e.result.fieldSize}` : ""].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className={cn("num text-xl", e.scoring.total > 0 ? "text-td-green" : "text-td-faint")}>{e.scoring.total}</span>
                  </button>
                ))}
                {evidence.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing in this view.</p>}
              </div>
            </Panel>
          )}
          {result?.events && result.events.length > 0 && (
            <Panel title={`Events (${result.events.length})`} pad={false}>
              <div className="max-h-[480px] overflow-y-auto">
                {result.events.map((ev, i) => (
                  <div key={i} className="border-b border-border px-4 py-2 text-sm last:border-0">
                    <p className={cn("font-semibold", !ev.event && "text-td-gold")}>{ev.name}</p>
                    <p className="text-xs text-muted-foreground">{[ev.event ?? "Not recognized", ev.kind, ev.heats > 1 ? `${ev.heats} ${ev.kind === "field" ? "flights" : "heats"}` : "", `field ${ev.fieldSize ?? ev.rows}`, ev.cornwall ? `${ev.cornwall} Cornwall` : "", ev.complete ? "final" : "live"].filter(Boolean).join(" · ")}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {!result && !running && <div className="panel p-10 text-center text-sm text-muted-foreground">Paste a past meet's public AthleticLIVE link and run a test. Verdict: {verdictOf({ ok: false, status: undefined })} until a real chain passes.</div>}
        </div>
      </div>
      {open && <EvidenceDialog e={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function EvidenceDialog({ e, onClose }: { e: LabEvidence; onClose: () => void }) {
  const [raw, setRaw] = useState<boolean>(false);
  const r = e.result;
  const row = (k: string, v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>
  ));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-3xl">{e.source.name}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="eyebrow mb-1">Source athlete</p>
            {row("School", e.source.school)}{row("Gender", e.source.gender === "G" ? "Girls" : e.source.gender === "B" ? "Boys" : e.source.gender)}
            {row("Grade", e.source.grade)}{row("Bib", e.source.bib)}{row("Source athlete ID", e.source.sourceId)}
            {e.source.members?.length ? row("Relay legs", e.source.members.join(", ")) : null}
          </div>
          <div>
            <p className="eyebrow mb-1">Master player</p>
            {e.master ? <>{row("Player", e.master.name)}{row("Master ID", e.master.id)}{row("School", e.master.school)}</>
              : e.relayMembers?.length ? e.relayMembers.map((m) => <div key={m.id}>{row(m.name, `${m.total ?? 0} pts`)}</div>)
              : <p className="text-sm text-muted-foreground">No master player. No points are awarded.</p>}
            {row("Confidence", e.match.confidence)}
            <p className="mt-1 text-sm">{e.match.reason}</p>
            {e.match.candidates?.length ? <p className="text-xs text-muted-foreground">Candidates: {e.match.candidates.map((c) => c.name).join(", ")}</p> : null}
          </div>
        </div>
        <div>
          <p className="eyebrow mb-1">Result</p>
          {row("Event", r.sourceEvent)}{row("Scored as", [r.event ?? "Not recognized", r.type].filter(Boolean).join(" · "))}{row("Round", r.round === "PRELIM" ? "Prelim" : "Final")}
          {row("Mark", r.mark || "—")}{row("Status", r.status)}{row("Overall place", r.place ? ord(r.place) : "—")}
          {row(r.type === "field" ? "Flight" : "Heat", r.heat ? `${r.heat} of ${r.heats ?? r.heat}` : "—")}{row(r.type === "field" ? "Flight place" : "Heat place", r.heatPlace ? ord(r.heatPlace) : "—")}
          {row("Field size (scored)", r.fieldSize)}{r.eventFieldSize && r.eventFieldSize !== r.fieldSize ? row("Field size (this round)", r.eventFieldSize) : null}
          {row("Seed", r.seedMark)}{row("Wind", r.wind)}{row("PR before meet", r.sourcePb)}{row("SR before meet", r.sourceSb)}
          {row("PB / SB", r.best === "PB" ? "Personal best" : r.best === "SB" ? "Season best" : r.best === "none" ? "Neither" : "Checked against history")}
          {row("Official", r.sourceFinal === true ? "Final" : r.sourceFinal === false ? "Live / unofficial" : "Not stated")}
          {r.historyOnly ? row("Counted", "No: same athlete ran the final") : null}
        </div>
        <div>
          <p className="eyebrow mb-1">Fantasy scoring · version {e.scoring.scoringVersion ?? 0}</p>
          {e.scoring.lines.length === 0 && <p className="text-sm text-muted-foreground">No fantasy points for this result.</p>}
          {e.scoring.lines.map((l, i) => <div key={i} className="flex justify-between py-1 text-sm"><span>{l.label}</span><span className={cn("num text-lg", l.points >= 0 ? "text-td-green" : "text-td-red")}>{l.points > 0 ? `+${l.points}` : l.points}</span></div>)}
          <div className="mt-1 flex justify-between border-t border-border pt-2 font-bold"><span>Total</span><span className="num text-2xl text-td-green">{e.scoring.total}</span></div>
          <p className="mt-1 text-xs text-td-faint">Same engine as live scoring. PB and SB never stack.</p>
        </div>
        {e.rawText && (
          <div>
            <button className="text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={() => setRaw(!raw)}>{raw ? "▾" : "▸"} Source record</button>
            {raw && <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-td-surface2 p-3 text-[11px] leading-snug text-muted-foreground">{e.rawText}</pre>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
