import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, OctagonAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MainLeagueBanner, PageHeader, Panel } from "@/components/td";
import { api } from "@/lib/api";
import { leagueKey, useLeague } from "@/lib/league";
import type { ChangePreview, HealthReport, NoteLog, PerfRow, ReconcileReport, Snapshot, Versions } from "@/lib/integrity";
import { cn } from "@/lib/utils";

type Tab = "health" | "reconcile" | "alerts" | "snapshots" | "versions" | "tables";
const TABS: [Tab, string][] = [["health", "Health"], ["reconcile", "Reconcile"], ["alerts", "Alert log"], ["snapshots", "Snapshots"], ["versions", "Versions"], ["tables", "Performance tables"]];

const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "green" | "gold" | "red" }) => (
  <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
    <span className="text-muted-foreground">{k}</span>
    <span className={cn("num font-semibold", tone === "green" && "text-td-green", tone === "gold" && "text-td-gold", tone === "red" && "text-td-red")}>{v}</span>
  </div>
);

/** Commissioner integrity tools: health, Reconcile Scores, notification log, snapshots, versions, performance tables. */
export default function Integrity() {
  const { league, isCommish } = useLeague();
  const [tab, setTab] = useState<Tab>("health");
  if (!isCommish) return <div><PageHeader title="Scoring Integrity" /><MainLeagueBanner>Only the commissioner can use these tools.</MainLeagueBanner></div>;
  return (
    <div>
      <PageHeader eyebrow="Commissioner" title="Scoring Integrity" sub="Every number here is recomputed by the server's one scoring engine." />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", tab === t ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "health" && <HealthTab leagueId={league.id} />}
      {tab === "reconcile" && <ReconcileTab leagueId={league.id} />}
      {tab === "alerts" && <AlertsTab leagueId={league.id} />}
      {tab === "snapshots" && <SnapshotsTab leagueId={league.id} />}
      {tab === "versions" && <VersionsTab leagueId={league.id} />}
      {tab === "tables" && <TablesTab />}
    </div>
  );
}

const tool = <T,>(leagueId: string, body: Record<string, unknown>): Promise<T> => api<T>(`/leagues/${leagueId}/tools`, { body });

function HealthTab({ leagueId }: { leagueId: string }) {
  const q = useQuery({ queryKey: ["health", leagueId], queryFn: () => tool<HealthReport>(leagueId, { op: "health" }) });
  const h = q.data;
  if (!h) return <Loader2 className="h-6 w-6 animate-spin text-td-green" />;
  const n = (v: unknown): number => Number(v ?? 0);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Athletes">
        <Row k="Master players" v={n(h.athletes.master)} /><Row k="Cornwall Central" v={n(h.athletes.cornwall)} />
        <Row k="Needs Review" v={n(h.athletes.needsReview)} tone={n(h.athletes.needsReview) ? "gold" : undefined} />
        <Row k="Unmatched (open)" v={n(h.athletes.unmatched)} tone={n(h.athletes.unmatched) ? "gold" : undefined} />
        <Row k="Possible duplicates" v={n(h.athletes.duplicateCandidates)} tone={n(h.athletes.duplicateCandidates) ? "gold" : undefined} />
        <Row k="Source ID conflicts" v={n(h.athletes.sourceConflicts)} tone={n(h.athletes.sourceConflicts) ? "red" : "green"} />
        <Row k="Saved source IDs" v={n(h.athletes.sourceLinks)} /><Row k="Confirmed aliases" v={n(h.athletes.aliases)} />
        {h.athletes.duplicateExamples.map((x) => <p key={x} className="text-xs text-td-gold">{x}</p>)}
      </Panel>
      <Panel title="Scoring">
        <Row k="Results imported" v={n(h.scoring.imported)} /><Row k="Results scored" v={n(h.scoring.scored)} /><Row k="Scoring lines" v={n(h.scoring.lines)} />
        <Row k="Rejected / flagged" v={n(h.scoring.rejected)} tone={n(h.scoring.rejected) ? "gold" : undefined} />
        <Row k="Duplicates blocked" v={n(h.scoring.duplicatesBlocked)} /><Row k="Official corrections applied" v={n(h.scoring.corrections)} />
        <Row k="Simultaneous imports serialized" v={n(h.scoring.simultaneousImportsSerialized)} />
        <Row k="Last reconcile" v={h.scoring.mismatches == null ? "Not run" : `${h.scoring.mismatches} mismatches`} tone={h.scoring.mismatches === 0 ? "green" : h.scoring.mismatches == null ? undefined : "red"} />
        <p className="mt-2 text-xs text-muted-foreground">{String(h.scoring.versions ?? "")}</p>
      </Panel>
      <Panel title="Meets">
        {h.meets.length === 0 && <p className="text-sm text-muted-foreground">No meets yet.</p>}
        {h.meets.map((m) => (
          <div key={m.id} className="border-b border-border py-2 last:border-0">
            <div className="flex justify-between text-sm font-semibold"><span>{m.name}</span><span className={m.live ? "text-td-red" : "text-muted-foreground"}>{m.live ? "LIVE" : m.status}</span></div>
            <p className={cn("text-xs", m.sourceStatus === "OK" ? "text-td-green" : "text-td-gold")}>{m.sourceStatus}</p>
            <p className="text-xs text-muted-foreground">W{m.week} · {m.events} events · {m.results} results · {m.scored} scored{m.freshnessMin != null ? ` · read ${m.freshnessMin} min ago` : ""}{m.history ? " · history" : ""}{m.rehearsal ? " · rehearsal" : ""}</p>
          </div>
        ))}
      </Panel>
      <div className="space-y-5">
        <Panel title="Notifications">
          <Row k="Queued" v={n(h.notifications.queued)} /><Row k="Delivered" v={n(h.notifications.delivered)} tone="green" />
          <Row k="No subscribed device" v={n(h.notifications.noDevices)} tone={n(h.notifications.noDevices) ? "gold" : undefined} />
          <Row k="Failed" v={n(h.notifications.failed)} tone={n(h.notifications.failed) ? "red" : undefined} /><Row k="Duplicates blocked" v={n(h.notifications.duplicatesBlocked)} />
        </Panel>
        <Panel title="Projections">
          <Row k="Generated" v={n(h.projections.generated)} /><Row k="Missing (no verified history)" v={n(h.projections.missing)} />
          <Row k="Errors" v={n(h.projections.errors)} tone={n(h.projections.errors) ? "red" : undefined} /><Row k="Stale" v={h.projections.stale ? "Yes" : "No"} />
        </Panel>
      </div>
    </div>
  );
}

function ReconcileTab({ leagueId }: { leagueId: string }) {
  const [r, setR] = useState<ReconcileReport | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const run = async (plant: boolean): Promise<void> => {
    setBusy(true);
    try { setR(await tool<ReconcileReport>(leagueId, { op: "reconcile", plant })); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Recomputes raw meet data → results → scoring engine → event totals → weekly totals → matchup totals and compares with what's stored. Nothing is changed.</p>
      <div className="flex gap-3">
        <Button disabled={busy} onClick={() => run(false)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Run Reconcile Scores</Button>
        <Button variant="outline" disabled={busy} onClick={() => run(true)}>Self-test (plant a problem in a copy)</Button>
      </div>
      {r && (
        <>
          <div className={cn("flex items-center gap-2 rounded-xl p-3 font-semibold", r.ok ? "bg-td-green/10 text-td-green" : "bg-td-red/10 text-td-red")}>
            {r.ok ? <CheckCircle2 className="h-5 w-5" /> : <OctagonAlert className="h-5 w-5" />}{r.verdict}
          </div>
          {r.planted && <p className="text-sm text-td-gold">Planted (copy only): removed {r.planted.removedResult ?? "—"}; duplicated {r.planted.duplicatedLine ?? "—"}</p>}
          <Panel title="Counts"><div className="grid gap-x-8 sm:grid-cols-2">{Object.entries(r.counts).map(([k, v]) => <Row key={k} k={k} v={v} tone={/Mismatch|Failures/i.test(k) && v > 0 ? "red" : undefined} />)}</div></Panel>
          {r.meets.map((m) => <p key={m.meetId} className="text-xs text-muted-foreground">{m.name}: {m.reread ? `${m.sourceRows} source rows · ${m.expected} expected · ${m.stored} stored · missing ${m.missing} · orphaned ${m.orphaned} · stale ${m.stale}` : "couldn't re-read the source"}</p>)}
          {r.issues.length > 0 && <Panel title={`Issues (${r.issues.length})`}>{r.issues.map((i, k) => <div key={k} className="border-b border-border py-1.5 text-sm last:border-0"><span className={cn("mr-2 text-[10px] font-black uppercase", i.severity === "mismatch" ? "text-td-red" : "text-td-gold")}>{i.kind}</span>{i.detail}</div>)}</Panel>}
        </>
      )}
    </div>
  );
}

function AlertsTab({ leagueId }: { leagueId: string }) {
  const q = useQuery({ queryKey: ["notelog", leagueId], queryFn: () => tool<{ log: NoteLog[]; duplicatesBlocked: number }>(leagueId, { op: "notelog" }) });
  if (!q.data) return <Loader2 className="h-6 w-6 animate-spin text-td-green" />;
  const tone = (s: string): string => (s === "delivered" ? "text-td-green" : s === "failed" ? "text-td-red" : "text-td-gold");
  return (
    <Panel title={`${q.data.log.length} logged · ${q.data.duplicatesBlocked} duplicates blocked`} pad={false}>
      {q.data.log.map((l) => (
        <div key={l.deliveryKey} className="border-b border-border px-4 py-2.5 last:border-0">
          <div className="flex justify-between text-sm"><span className="font-semibold">{l.title}</span><span className={cn("text-[11px] font-black uppercase", tone(l.status))}>{l.status}</span></div>
          <p className="text-xs text-muted-foreground">{l.category} · {l.recipients} recipient(s) · {l.attempts} attempt(s) · opens {l.link} · {new Date(l.createdAt).toLocaleString()} · key {l.deliveryKey.slice(0, 8)}</p>
          {l.error && <p className="text-xs text-td-faint">{l.error}</p>}
        </div>
      ))}
    </Panel>
  );
}

function SnapshotsTab({ leagueId }: { leagueId: string }) {
  const { act } = useLeague();
  const q = useQuery({ queryKey: ["snaps", leagueId], queryFn: () => tool<{ snapshots: Snapshot[] }>(leagueId, { op: "snapshots" }) });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Saved automatically before every reprocess, scoring change and restore.</p>
      <Button variant="outline" onClick={async () => { if (await act({ type: "snapshotNow", reason: "Manual snapshot (website)" }, "Snapshot saved")) void q.refetch(); }}>Save a snapshot now</Button>
      {(q.data?.snapshots ?? []).map((s) => (
        <div key={s.at} className="flex items-center justify-between rounded-xl bg-td-surface p-3">
          <div><p className="text-sm font-semibold">{s.reason}</p><p className="text-xs text-muted-foreground">{new Date(s.at).toLocaleString()} · {s.results} results · {s.points} pts</p></div>
          <Button size="sm" variant="ghost" className="text-td-gold" onClick={async () => {
            if (!window.confirm("Restore this snapshot? The current state is saved first, so this can be undone.")) return;
            if (await act({ type: "restoreSnapshot", at: s.at }, "Snapshot restored")) void q.refetch();
          }}>Restore</Button>
        </div>
      ))}
    </div>
  );
}

function VersionsTab({ leagueId }: { leagueId: string }) {
  const q = useQuery({ queryKey: ["versions", leagueId], queryFn: () => tool<Versions>(leagueId, { op: "versions" }) });
  const v = q.data;
  if (!v) return <Loader2 className="h-6 w-6 animate-spin text-td-green" />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={`In force: ${v.current?.label ?? "—"}`}>
        <p className="eyebrow mb-1">Scoring rule versions</p>
        {v.rules.map((r) => <Row key={r.version} k={`v${r.version}`} v={`${r.since ? new Date(r.since).toLocaleString() : "Original"}${r.by ? ` · ${r.by}` : ""}`} />)}
        <p className="eyebrow mb-1 mt-4">Table versions</p>
        {v.tables.map((t) => <div key={t.version} className="border-b border-border py-1.5 text-sm last:border-0"><b>v{t.version}</b> · {t.by}<p className="text-xs text-muted-foreground">{new Date(t.at).toLocaleString()} · {t.detail}</p></div>)}
      </Panel>
      <Panel title="Change log (old → new)">
        {v.audit.map((a, i) => <div key={i} className="border-b border-border py-1.5 last:border-0"><p className="text-xs font-semibold">{a.actorName} · {new Date(a.at).toLocaleString()}</p><p className="text-xs text-muted-foreground">{a.detail}</p></div>)}
      </Panel>
    </div>
  );
}

/** Performance tables 2026–2032: view any season; the Main League commissioner validates, previews and publishes. */
function TablesTab() {
  const { league } = useLeague();
  const qc = useQueryClient();
  const [season, setSeason] = useState<number>(2026);
  const [gender, setGender] = useState<"B" | "G">("B");
  const [edit, setEdit] = useState<{ event: string; tiers: { mark: string; points: string }[] } | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const data = useQuery({ queryKey: ["scoring", league.id, league.version], queryFn: () => api<{ performance: PerfRow[]; performanceEvents: { event: string; measurement: string }[] }>(`/leagues/${league.id}/scoring`) });
  const rows = useMemo(() => (data.data?.performance ?? []).filter((p) => p.season === season && p.gender === gender), [data.data, season, gender]);
  const can = league.canEditGlobal;
  const payload = (): { mark: string; points: number }[] => (edit?.tiers ?? []).filter((t) => t.mark.trim()).map((t) => ({ mark: t.mark.trim(), points: Number(t.points) }));

  const check = async (): Promise<void> => {
    if (!edit) return;
    try { setPreview(await tool<ChangePreview>(league.id, { op: "preview", table: { event: edit.event, gender, season, tiers: payload() } })); } catch (e) { toast.error((e as Error).message); }
  };
  const publish = async (): Promise<void> => {
    if (!edit) return;
    try {
      await api("/global/action", { body: { type: "setPerformanceTable", event: edit.event, gender, season, tiers: payload() } });
      toast.success(`${season} ${gender === "G" ? "Girls" : "Boys"} ${edit.event} published`);
      setEdit(null); setPreview(null);
      window.setTimeout(() => { void qc.invalidateQueries({ queryKey: leagueKey(league.id) }); void data.refetch(); }, 600);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      {!can && <MainLeagueBanner>Tables are the same in every league. Only the Main League commissioner can change them.</MainLeagueBanner>}
      <div className="flex flex-wrap items-center gap-2">
        {[2026, 2027, 2028, 2029, 2030, 2031, 2032].map((y) => <button key={y} onClick={() => setSeason(y)} className={cn("rounded-full px-3 py-1 text-sm font-semibold", season === y ? "bg-td-green text-black" : "bg-td-surface2")}>{y}</button>)}
        <span className="mx-2 h-5 w-px bg-border" />
        {(["B", "G"] as const).map((g) => <button key={g} onClick={() => setGender(g)} className={cn("rounded-full px-3 py-1 text-sm font-semibold", gender === g ? "bg-td-gold text-black" : "bg-td-surface2")}>{g === "B" ? "Boys" : "Girls"}</button>)}
      </div>
      <p className="text-xs text-muted-foreground">The meet's date picks the season's table. Only the best tier reached scores, separately for every event an athlete enters.</p>
      <Panel pad={false}>
        {(data.data?.performanceEvents ?? []).map(({ event, measurement }) => {
          const t = rows.filter((p) => p.event === event).sort((a, b) => a.points - b.points);
          const dir = measurement === "TIME" ? "or faster" : measurement === "HEIGHT" ? "or higher" : "or farther";
          return (
            <div key={event} className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-0">
              <div className="min-w-0">
                <p className="font-semibold">{event}</p>
                <p className="text-xs text-muted-foreground">{t.length ? t.map((x) => `${x.mark} ${dir} → ${x.points}`).join(" · ") : "No table: no time/mark points"}{t[0]?.ver ? ` · table v${Math.max(...t.map((x) => x.ver ?? 1))}` : ""}</p>
              </div>
              {can && <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setEdit({ event, tiers: t.length ? t.map((x) => ({ mark: x.mark, points: String(x.points) })) : [{ mark: "", points: "" }] }); }}>Edit</Button>}
            </div>
          );
        })}
      </Panel>
      {edit && (
        <Panel title={`${season} ${gender === "G" ? "Girls" : "Boys"} ${edit.event}`}>
          {edit.tiers.map((t, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Input value={t.mark} placeholder="mark" onChange={(e) => { const n = [...edit.tiers]; n[i] = { ...t, mark: e.target.value }; setEdit({ ...edit, tiers: n }); setPreview(null); }} />
              <Input value={t.points} placeholder="pts" className="w-24" onChange={(e) => { const n = [...edit.tiers]; n[i] = { ...t, points: e.target.value }; setEdit({ ...edit, tiers: n }); setPreview(null); }} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEdit({ ...edit, tiers: [...edit.tiers, { mark: "", points: "" }] })}>Add tier</Button>
            <Button variant="outline" onClick={check}>Validate & preview</Button>
            <Button disabled={!preview?.ok} onClick={publish}>Publish</Button>
            <Button variant="ghost" onClick={() => { setEdit(null); setPreview(null); }}>Cancel</Button>
          </div>
          {preview && (
            <div className="mt-3 space-y-1 text-sm">
              {preview.problems.map((p) => <p key={p} className="text-td-red">{p}</p>)}
              {preview.ok && <p className="text-td-green">Valid. {preview.example ? `${preview.example.name} week ${preview.example.week}: ${preview.example.oldScore} → ${preview.example.newScore}` : "No real result changes."} {preview.athletesAffected} athlete-week(s) affected. Publishes as tables v{preview.currentVersion.tables + 1}.</p>}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
