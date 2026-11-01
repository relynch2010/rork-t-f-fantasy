import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Panel } from "@/components/td";
import { api } from "@/lib/api";
import { useLeague } from "@/lib/league";
import { fmtPts } from "@/lib/types";
import { cn } from "@/lib/utils";

type Outcome = { home: number; away: number | null; winner: string };
type LabMatchup = { label: string; home: string; away: string } & Record<string, Outcome | string>;
type Formula = { name: string; math: string; total?: number; avgSeededMeet?: number; avgUnseededMeet?: number; fairnessViolations?: number };
type Side = { name: string; mark: string; place: number | null; points: number };
type SeedLab = {
  ok: boolean; message?: string; source?: string; rulesVersion?: string; seasonNote?: string | null; contestsNote?: string; fairnessRule?: string;
  formulas?: Record<string, Formula>; sectionStats?: { sectioned: number; seededSection: number; unseededSection: number };
  fairnessExamples?: { meet: string; event: string; unseeded: Side; seeded: Side }[]; matchups?: LabMatchup[]; matchupFlipsVsCurrent?: Record<string, number>;
};
type RelayLab = {
  ok: boolean; message?: string; source?: string; contestsNote?: string; options?: Record<string, { name: string; math: string }>; howItWorks?: string[];
  relays?: { meet: string; date: string; event: string; gender: string; place: number | null; status: string; legs: string[]; divisor: number; perLeg: Record<string, number> }[];
  matchups?: LabMatchup[]; matchupFlipsVsCurrent?: Record<string, number>;
};
type Err = { n: number; mae: number; rmse: number; bias: number; coverage: number };
type Backtest = {
  ok: boolean; message?: string; modelVersion?: string; samples?: number; meetsTested?: number; withEntries?: Err; withoutEntries?: Err; naiveLastMeet?: Err;
  headToHead?: { correct: number; total: number; accuracy: number | null }; perMeet?: { date: string; meet: string; athletes: number; mae: number; projected: number; actual: number }[]; notes?: string[];
};

const SEED_KEYS = ["current", "neutral", "combined", "strength", "beatSeed"];
const RELAY_KEYS = ["current", "divided", "full"];

function Matchups({ ms, keys, names }: { ms: LabMatchup[]; keys: string[]; names: Record<string, string> }) {
  return (
    <Panel title="Played matchups, re-scored">
      <div className="space-y-4">
        {ms.map((m, i) => {
          const cur = m.current as Outcome | undefined;
          return (
            <div key={i}>
              <p className="mb-1 text-sm font-semibold">{m.label}: {m.home} vs {m.away}</p>
              {keys.map((k) => {
                const o = m[k] as Outcome | undefined;
                if (!o || typeof o === "string") return null;
                const flip = k !== "current" && o.winner !== cur?.winner;
                return <div key={k} className="flex justify-between gap-3 text-xs"><span className="text-muted-foreground">{names[k] ?? k}</span><span className="num">{fmtPts(o.home)}–{o.away === null ? "bye" : fmtPts(o.away)} <b className={cn("ml-2", flip && "text-td-gold")}>{o.winner}</b></span></div>;
              })}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Commissioner Scoring Lab: read-only comparisons on the league's real AthleticLIVE results. Nothing is published here. */
export default function ScoringLab() {
  const { league, isCommish } = useLeague();
  const [tab, setTab] = useState<"seed" | "relay" | "accuracy">("seed");
  const [nonce, setNonce] = useState<number>(0);
  const op = tab === "seed" ? "seedLab" : tab === "relay" ? "relayLab" : "backtest";
  const q = useQuery({
    queryKey: ["lab", league.id, op, nonce],
    queryFn: () => api<SeedLab & RelayLab & Backtest>(`/leagues/${league.id}/tools`, { body: { op } }),
    enabled: isCommish, staleTime: 5 * 60_000,
  });
  if (!isCommish) return <Empty title="Commissioner only" />;
  const d = q.data;
  return (
    <div>
      <PageHeader title="Scoring Lab" sub="Re-scores real past meets with each option. Preview only: nothing is published, and relay scoring and the schedule don't change until you approve." right={<Button variant="secondary" onClick={() => setNonce(nonce + 1)} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} /> Run again</Button>} />
      <div className="mb-4 flex gap-2">
        {([["seed", "Seeded / Unseeded"], ["relay", "Relays"], ["accuracy", "Projection accuracy"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {q.isLoading || !d ? <p className="text-sm text-muted-foreground"><FlaskConical className="mr-1 inline h-4 w-4" />Re-scoring real meets…</p> : !d.ok ? <Empty title="Not enough data">{d.message}</Empty> : (
        <div className="space-y-4">
          {d.source && <p className="text-xs font-semibold text-td-green">{d.source}{d.rulesVersion ? ` · ${d.rulesVersion}` : ""}</p>}
          {d.seasonNote && <p className="text-xs text-td-faint">{d.seasonNote}</p>}
          {tab === "seed" && d.formulas && (
            <>
              {d.sectionStats && <Panel title="What the data shows"><p className="text-sm text-muted-foreground">{d.sectionStats.sectioned} results came from events split into Seeded and Unseeded sections ({d.sectionStats.seededSection} seeded, {d.sectionStats.unseededSection} unseeded). Each section was ranked on its own, so an unseeded-section winner gets 1st-place points.</p><p className="mt-1 text-xs text-td-faint">{d.fairnessRule}</p></Panel>}
              <div className="grid gap-4 md:grid-cols-2">
                {SEED_KEYS.map((k) => {
                  const f = d.formulas?.[k];
                  if (!f) return null;
                  return (
                    <Panel key={k} title={f.name}>
                      <p className="text-xs text-muted-foreground">{f.math}</p>
                      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                        {[["Avg seeded", fmtPts(f.avgSeededMeet)], ["Avg unseeded", fmtPts(f.avgUnseededMeet)], ["Unfair cases", String(f.fairnessViolations ?? 0)], ["Matchups flip", String(d.matchupFlipsVsCurrent?.[k] ?? 0)]].map(([l, v]) => (
                          <div key={l}><p className="num text-xl">{v}</p><p className="text-[9px] font-black uppercase text-td-faint">{l}</p></div>
                        ))}
                      </div>
                    </Panel>
                  );
                })}
              </div>
              {(d.fairnessExamples ?? []).length > 0 && (
                <Panel title="Real cases under current rules">
                  <div className="space-y-2 text-xs">{d.fairnessExamples?.slice(0, 5).map((e, i) => (
                    <div key={i}><b>{e.event} · {e.meet}</b><div className="text-td-gold">Unseeded {e.unseeded.name}: {e.unseeded.mark} → {fmtPts(e.unseeded.points)} pts</div><div className="text-muted-foreground">Seeded {e.seeded.name}: {e.seeded.mark} → {fmtPts(e.seeded.points)} pts</div></div>
                  ))}</div>
                </Panel>
              )}
              {(d.matchups ?? []).length > 0 && <Matchups ms={d.matchups ?? []} keys={SEED_KEYS} names={Object.fromEntries(Object.entries(d.formulas).map(([k, f]) => [k, f.name]))} />}
              <p className="rounded-xl bg-td-green/10 p-3 text-xs text-td-green">Tell me which formula to publish. It goes out as a new scoring version from the Main League; finished weeks keep their scores.</p>
            </>
          )}
          {tab === "relay" && d.options && (
            <>
              <Panel title="How relay points work today"><ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{d.howItWorks?.map((h) => <li key={h}>{h}</li>)}</ul></Panel>
              <div className="grid gap-4 md:grid-cols-3">
                {RELAY_KEYS.map((k) => d.options?.[k] && <Panel key={k} title={d.options[k].name}><p className="text-xs text-muted-foreground">{d.options[k].math}</p>{k !== "current" && <p className="mt-2 text-xs font-semibold">Matchups that flip: {d.matchupFlipsVsCurrent?.[k] ?? 0}</p>}</Panel>)}
              </div>
              <Panel title="Real relays · points per leg" pad={false}>
                {d.relays?.slice(0, 15).map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] gap-2 border-b border-border px-4 py-2 text-sm last:border-0">
                    <span><b>{r.gender === "G" ? "Girls" : "Boys"} {r.event}</b> · {r.place ? `${r.place}th` : r.status}<span className="block text-xs text-muted-foreground">{r.meet} · {r.legs.join(", ")}</span></span>
                    <span className="num text-right">{fmtPts(r.perLeg.current)} / {fmtPts(r.perLeg.divided)} / {fmtPts(r.perLeg.full)}<span className="block text-[10px] text-td-faint">today / ÷{r.divisor} / full</span></span>
                  </div>
                ))}
              </Panel>
              {(d.matchups ?? []).length > 0 && <Matchups ms={d.matchups ?? []} keys={RELAY_KEYS} names={Object.fromEntries(Object.entries(d.options).map(([k, o]) => [k, o.name]))} />}
              <p className="rounded-xl bg-td-green/10 p-3 text-xs text-td-green">Relay scoring stays exactly as it is until you pick option 1, 2 or 3.</p>
            </>
          )}
          {tab === "accuracy" && d.withEntries && (
            <>
              <Panel title={`Measured accuracy · ${d.modelVersion} · ${d.samples} athlete-meets, ${d.meetsTested} past meets`}>
                {([["Events guessed from history", d.withoutEntries], ["Events known in advance", d.withEntries], ["Baseline: same as last meet", d.naiveLastMeet]] as [string, Err | undefined][]).map(([l, e]) => e && (
                  <div key={l} className="flex justify-between border-b border-border py-2 text-sm last:border-0"><span>{l}<span className="block text-xs text-td-faint">bias {e.bias >= 0 ? "+" : ""}{fmtPts(e.bias)} · {Math.round(e.coverage * 100)}% inside projected range</span></span><span className="num text-xl">±{fmtPts(e.mae)}</span></div>
                ))}
                {d.headToHead?.accuracy != null && <p className="mt-2 text-sm">Picks the higher scorer <b className="text-td-green">{Math.round(d.headToHead.accuracy * 100)}%</b> of the time <span className="text-xs text-td-faint">({d.headToHead.correct} of {d.headToHead.total} pairs)</span></p>}
              </Panel>
              <Panel title="Meet by meet" pad={false}>
                {d.perMeet?.map((m) => <div key={m.date} className="flex justify-between border-b border-border px-4 py-2 text-sm last:border-0"><span>{m.meet}<span className="block text-xs text-td-faint">{m.date} · {m.athletes} athletes</span></span><span className="text-right"><b className="num">±{fmtPts(m.mae)}</b><span className="block text-xs text-td-faint">proj {Math.round(m.projected)} / actual {Math.round(m.actual)}</span></span></div>)}
              </Panel>
              <ul className="space-y-1 text-xs text-td-faint">{d.notes?.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
