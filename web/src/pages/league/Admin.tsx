import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, CalendarDays, CheckCircle2, ClipboardCheck, Eye, FileText, FlaskConical, History, Info, Link2, Loader2, MinusCircle, Plus, RefreshCw, ServerCog, SlidersHorizontal, TestTube2, Globe2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MainLeagueBanner, PageHeader, Panel } from "@/components/td";
import { api } from "@/lib/api";
import { leagueKey, useLeague } from "@/lib/league";
import {
  PROJ_STATE_LABEL, fmtPts,
  type AdminAccess, type AdminChangelog, type AdminDraftBody, type AdminPreview, type AdminResult, type AdminVersionRow, type AdminVersions,
  type DataValidation, type ProjHealthBody, type ProjMeetPreviewBody, type ProjMeetsBody, type ScoringRules,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "hub" | "scoring" | "projections" | "data" | "history";
const TABS: [Tab, string][] = [["hub", "Hub"], ["scoring", "Scoring"], ["projections", "Projections"], ["data", "Meets & results"], ["history", "History"]];
const tool = <T,>(leagueId: string, body: Record<string, unknown>): Promise<T> => api<T>(`/leagues/${leagueId}/tools`, { body });
const uid = (): string => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "green" | "gold" | "red" }) => (
  <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
    <span className="text-muted-foreground">{k}</span>
    <span className={cn("num font-semibold", tone === "green" && "text-td-green", tone === "gold" && "text-td-gold", tone === "red" && "text-td-red")}>{v}</span>
  </div>
);

/** Commissioner Admin Panel (website). Every request is checked by the server; this page only shows its answers. */
export default function Admin() {
  const { league, isCommish } = useLeague();
  const [tab, setTab] = useState<Tab>("hub");
  const [msg, setMsg] = useState<string | null>(null);
  const access = useQuery({ queryKey: ["admin-access", league.id], queryFn: () => tool<AdminAccess>(league.id, { op: "adminAccess" }), enabled: isCommish, retry: false });
  if (!isCommish) return <div><PageHeader title="Admin Panel" /><MainLeagueBanner>Not allowed: only the Main League commissioner account can open the Admin Panel.</MainLeagueBanner></div>;
  const a = access.data;
  if (access.isError) return <div><PageHeader title="Admin Panel" /><MainLeagueBanner>{(access.error as Error).message}</MainLeagueBanner></div>;
  if (!a) return <Loader2 className="h-6 w-6 animate-spin text-td-green" />;
  if (!a.allowed) return <div><PageHeader title="Admin Panel" /><MainLeagueBanner>Not allowed: {a.reason}</MainLeagueBanner></div>;
  const global = a.mode === "global";
  return (
    <div>
      <PageHeader eyebrow={global ? "Global · every league" : "Test league · sandbox only"} title="Admin Panel" sub={a.reason} />
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-td-surface p-4">
        {global ? <Globe2 className="h-6 w-6 text-td-gold" /> : <TestTube2 className="h-6 w-6 text-td-flex" />}
        <div className="text-sm"><b>{a.leagueName}</b><p className="text-xs text-muted-foreground">{global ? "Publishing here changes scoring for every league. Finished weeks stay frozen." : "Changes apply only to this test league. The Main League is never touched."}</p></div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", tab === t ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {msg && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-td-green/10 p-3 text-sm">
          <ServerCog className="mt-0.5 h-4 w-4 shrink-0 text-td-green" /><span className="flex-1">{msg}</span>
          <button className="text-xs text-muted-foreground" onClick={() => setMsg(null)}>Dismiss</button>
        </div>
      )}
      {tab === "hub" && <Hub access={a} />}
      {tab === "scoring" && <ScoringTab access={a} onMessage={setMsg} />}
      {tab === "projections" && <><ProjectionMeets global={global} onMessage={setMsg} /><ProjectionsTab onMessage={setMsg} /></>}
      {tab === "data" && <DataTab onMessage={setMsg} />}
      {tab === "history" && <HistoryTab access={a} onMessage={setMsg} />}
    </div>
  );
}

function Hub({ access }: { access: AdminAccess }) {
  const { league } = useLeague();
  const base = `/league/${league.id}`;
  const L = ({ to, icon, title, sub }: { to: string; icon: React.ReactNode; title: string; sub: string }) => (
    <Link to={`${base}/${to}`} className="flex items-center gap-3 rounded-xl bg-td-surface2 p-3 hover:bg-td-raised">{icon}<span><b className="block text-sm">{title}</b><span className="text-xs text-muted-foreground">{sub}</span></span></Link>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title="Scoring">
        <div className="grid gap-2">
          <L to="scoring-lab" icon={<FlaskConical className="h-5 w-5 text-td-gold" />} title="Scoring lab" sub="Compare rule ideas on real meets. Preview only" />
          <L to="global" icon={<SlidersHorizontal className="h-5 w-5 text-td-gold" />} title="Global game settings" sub={access.mode === "global" ? "Standards, tables, roster, alerts" : "View only"} />
        </div>
      </Panel>
      <Panel title="Meets & results">
        <div className="grid gap-2">
          <L to="meets" icon={<CalendarDays className="h-5 w-5 text-td-green" />} title="Meets" sub="Meets, weeks, links and syncs" />
          <L to="commish" icon={<ClipboardCheck className="h-5 w-5 text-td-green" />} title="Unmatched results" sub="Review flows with confirmation" />
          <L to="integrity" icon={<Activity className="h-5 w-5 text-td-green" />} title="Scoring integrity" sub="Health, reconcile, snapshots" />
        </div>
      </Panel>
      <Panel title="League">
        <div className="grid gap-2">
          <L to="draft" icon={<History className="h-5 w-5 text-td-green" />} title="Draft" sub="Order, start, results" />
          <L to="waivers" icon={<RefreshCw className="h-5 w-5 text-td-green" />} title="Waivers & free agents" sub="Claims and priority" />
          <L to="activity" icon={<Activity className="h-5 w-5 text-td-green" />} title="Transactions" sub="Every add, drop and trade" />
          <L to="settings" icon={<SlidersHorizontal className="h-5 w-5 text-td-green" />} title="League settings" sub="Name, size, draft time" />
        </div>
      </Panel>
      <p className="flex items-start gap-2 text-xs text-muted-foreground lg:col-span-3"><Info className="h-4 w-4 shrink-0" />{access.limits}</p>
    </div>
  );
}

type NumKey = "participation" | "pb" | "sb" | "standardCap" | "schoolRecord" | "fumble" | "dqdnf";
type ListKey = "overall" | "relay" | "heat";
const NUM_FIELDS: [NumKey, string][] = [["participation", "Participation"], ["pb", "PB"], ["sb", "SB (only if not a PB)"], ["standardCap", "Standards cap"], ["schoolRecord", "School record"], ["fumble", "Baton fumble"], ["dqdnf", "DQ / DNF"]];
const LIST_FIELDS: [ListKey, string][] = [["overall", "Overall place 1st→"], ["relay", "Relay place 1st→"], ["heat", "Heat place 1st→"]];

function ScoringTab({ access, onMessage }: { access: AdminAccess; onMessage: (m: string) => void }) {
  const { league, act } = useLeague();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-draft", league.id, league.globalVersion], queryFn: () => tool<AdminDraftBody>(league.id, { op: "draftLoad" }) });
  const [rules, setRules] = useState<ScoringRules | null>(null);
  const [preview, setPreview] = useState<AdminPreview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const rid = useRef(uid());
  const global = access.mode === "global";
  useEffect(() => { if (q.data) setRules(q.data.draft?.rules ?? q.data.current.rules); }, [q.data]);
  const current = q.data?.current.rules;
  const changed = useMemo(() => !!rules && !!current && JSON.stringify(rules) !== JSON.stringify(current), [rules, current]);
  if (!q.data || !rules || !current) return <Loader2 className="h-6 w-6 animate-spin text-td-green" />;

  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn(); } catch (e) { onMessage((e as Error).message); } finally { setBusy(false); } };
  const set = (patch: Partial<ScoringRules>) => { setRules({ ...rules, ...patch }); setPreview(null); };
  const save = () => run(async () => { const r = await tool<AdminResult>(league.id, { op: "draftSave", rules }); onMessage(r.message ?? "Saved."); await q.refetch(); });
  const discard = () => run(async () => { const r = await tool<AdminResult>(league.id, { op: "draftClear" }); onMessage(r.message ?? "Discarded."); setPreview(null); await q.refetch(); });
  const runPreview = () => run(async () => setPreview(await tool<AdminPreview>(league.id, { op: "draftPreview", rules })));
  const publish = () => run(async () => {
    if (typed !== "PUBLISH") return;
    if (global) {
      if (await act({ type: "updateScoring", rules }, "Server confirmed: new scoring version published to every league")) {
        await tool<AdminResult>(league.id, { op: "draftClear" });
        onMessage("Published. Finished weeks keep their scores.");
      }
    } else {
      const r = await tool<AdminResult>(league.id, { op: "sandboxPublish", rules, confirm: "PUBLISH", requestId: rid.current });
      onMessage([r.message, r.finishedWeeksUnchanged === true ? "Finished weeks verified unchanged." : r.finishedWeeksUnchanged === false ? "Warning: finished-week fingerprint changed." : null].filter(Boolean).join(" "));
      rid.current = uid();
      await qc.invalidateQueries({ queryKey: leagueKey(league.id) });
    }
    setTyped(""); setPreview(null); await q.refetch();
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={global ? "Draft · global (every league)" : "Draft · test-league sandbox"} right={<span className="text-xs text-muted-foreground">Live: {q.data.current.label}</span>}>
        {q.data.draft && <p className="mb-2 text-xs text-td-flex">Saved draft by {q.data.draft.by} · {new Date(q.data.draft.at).toLocaleString()}</p>}
        {NUM_FIELDS.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0">
            <span className="text-sm text-muted-foreground">{label}{rules[k] !== current[k] && <span className="ml-2 text-xs text-td-gold">was {current[k]}</span>}</span>
            <Input type="number" step="0.5" className="h-8 w-24 text-right" value={rules[k]} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<ScoringRules>)} />
          </div>
        ))}
        {LIST_FIELDS.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0">
            <span className="text-sm text-muted-foreground">{label}{JSON.stringify(rules[k]) !== JSON.stringify(current[k]) && <span className="ml-2 text-xs text-td-gold">was {current[k].join("/")}</span>}</span>
            <Input className="h-8 w-44 text-right" defaultValue={rules[k].join(", ")} key={`${k}-${q.dataUpdatedAt}`}
              onBlur={(e) => set({ [k]: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)) } as Partial<ScoringRules>)} />
          </div>
        ))}
        <p className="mt-2 text-xs text-muted-foreground">Seeded brackets: {rules.percentile.map((p) => `${p.pts} @ ${Math.round(p.pct * 100)}%`).join(" · ")}. Unseeded section: {(rules.percentileUnseeded ?? []).map((p) => `${p.pts} @ ${Math.round(p.pct * 100)}%`).join(" · ") || "not set"}. PB-only rule is fixed (SB pays only when it isn't a PB). Edit brackets and on/off switches in the iPhone editor.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={save}>Save draft</Button>
          <Button variant="secondary" disabled={busy || !changed} onClick={runPreview}>Preview on real results</Button>
          {q.data.draft && <Button variant="ghost" disabled={busy} onClick={discard}>Discard draft</Button>}
        </div>
      </Panel>
      <Panel title="Preview & publish">
        {!preview ? <p className="text-sm text-muted-foreground">{changed ? "Run a preview to see the side-by-side comparison before publishing." : "No changes from the live rules."}</p> : (
          <div className="space-y-3">
            {(preview.problems ?? []).map((p) => <p key={p} className="text-sm text-td-red">{p}</p>)}
            <div className="rounded-xl bg-td-surface2 p-3">
              <div className="mb-1 grid grid-cols-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><span>Category</span><span>Live</span><span>Draft</span></div>
              {preview.diff.map((d) => <div key={d.key} className="grid grid-cols-3 text-sm"><span>{d.key}</span><span className="text-muted-foreground">{d.currentText}</span><span className="font-semibold text-td-gold">{d.nextText}</span></div>)}
            </div>
            <Row k="Athlete-weeks that would change" v={preview.athletesAffected} />
            <Row k="Finished weeks protected" v={preview.finishedWeeksProtected.length ? preview.finishedWeeksProtected.join(", ") : "none"} tone="green" />
            <Row k="Preview changed live data" v={preview.unchanged === false ? "Yes" : "No"} tone={preview.unchanged === false ? "red" : "green"} />
            {preview.example && <p className="text-xs text-muted-foreground">Example: {preview.example.name}, week {preview.example.week}: {fmtPts(preview.example.oldScore)} → {fmtPts(preview.example.newScore)}</p>}
            {preview.note && <p className="text-xs text-muted-foreground">{preview.note}</p>}
            <p className="text-xs text-td-gold">{global ? "Takes effect immediately for every league's open and future weeks. Finished weeks keep their scores." : "Takes effect immediately in this test league only."}</p>
            <div className="flex items-center gap-2">
              <Input placeholder="Type PUBLISH" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 w-40" />
              <Button disabled={busy || typed !== "PUBLISH" || !preview.ok || preview.diff.length === 0} onClick={publish}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : global ? "Publish to every league" : "Publish to this test league"}</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** Meets projections learn from: AthleticLIVE links or pasted results text. Success is only shown from the server's reply. */
function ProjectionMeets({ global, onMessage }: { global: boolean; onMessage: (m: string) => void }) {
  const { league } = useLeague();
  const q = useQuery({ queryKey: ["admin-projmeets", league.id], queryFn: () => tool<ProjMeetsBody>(league.id, { op: "projMeets" }) });
  const qc = useQueryClient();
  const [source, setSource] = useState<"link" | "text">("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<ProjMeetPreviewBody | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rid = useRef(uid());
  const today = new Date().toISOString().slice(0, 10);
  const input = (): Record<string, unknown> => (source === "link" ? { url: url.trim() } : { text, name: name.trim(), date });
  const canCheck = source === "link" ? url.trim().length > 0 : text.trim().length > 0 && name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return; setBusy(key);
    try { await fn(); } catch (e) { onMessage((e as Error).message); } finally { setBusy(null); }
  };
  const apply = (r: ProjMeetsBody) => {
    qc.setQueryData(["admin-projmeets", league.id], r);
    if (r.message) onMessage(r.message);
    rid.current = uid();
    void qc.invalidateQueries({ queryKey: ["admin-proj", league.id] });
  };
  const check = () => run("check", async () => { setPreview(await tool<ProjMeetPreviewBody>(league.id, { op: "projMeetPreview", ...input() })); });
  const add = () => run("add", async () => {
    const r = await tool<ProjMeetsBody>(league.id, { op: "projMeetAdd", requestId: rid.current, ...input() });
    apply(r); if (r.ok) { setPreview(null); setUrl(""); setText(""); setName(""); setDate(""); }
  });
  const remove = (id: string, label: string) => {
    if (!window.confirm(`Remove ${label} from projections? ${global ? "Every league stops using it within 30 minutes." : "This test league stops using it."} Real scores don't change.`)) return;
    void run(`rm-${id}`, async () => apply(await tool<ProjMeetsBody>(league.id, { op: "projMeetRemove", id, requestId: rid.current })));
  };
  const rebuild = () => run("rebuild", async () => apply(await tool<ProjMeetsBody>(league.id, { op: "projMeetsRebuild", requestId: rid.current })));
  const b = q.data;
  const chip = (s: ProjMeetsBody["meets"][number]["stat"]) => {
    if (!s) return <span className="rounded-full bg-td-surface2 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">Waiting for rebuild</span>;
    if (s.error) return <span className="rounded-full bg-td-red/15 px-2 py-0.5 text-[10px] font-bold text-td-red">{s.kept ? `Refresh failed · kept ${s.results}` : "Failed"}</span>;
    return <span className="rounded-full bg-td-green/15 px-2 py-0.5 text-[10px] font-bold text-td-green">{s.results} marks · {s.athletes} athletes</span>;
  };
  return (
    <Panel title="Projection meets" right={<span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", global ? "bg-td-gold/15 text-td-gold" : "bg-td-flex/15 text-td-flex")}>{global ? "Every league" : "Test league"}</span>}>
      <p className="mb-4 text-xs text-muted-foreground">{b?.scopeNote ?? "Projections only: these meets never score points or set PBs/SBs."}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex gap-2">
            {([["link", "AthleticLIVE link"], ["text", "Paste results"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => { setSource(k); setPreview(null); }} className={cn("rounded-full px-3 py-1 text-xs font-semibold", source === k ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground")}>{l}</button>
            ))}
          </div>
          {source === "link" ? (
            <Input placeholder="https://live.athletic.net/meets/12345" value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} />
          ) : (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_160px] gap-2">
                <Input placeholder="Meet name" value={name} onChange={(e) => { setName(e.target.value); setPreview(null); }} />
                <Input type="date" max={today} value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} />
              </div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); setPreview(null); }}
                placeholder={"Paste a table (Event, Name, School, Mark) or results text like:\nGirls 55 Meter Dash\n1 Jane Doe 11 Cornwall Central 7.45"}
                className="min-h-[150px] w-full rounded-xl border border-border bg-td-surface2 p-3 font-mono text-xs outline-none focus:border-td-green"
              />
            </div>
          )}
          <Button variant="secondary" className="mt-3 w-full" disabled={!!busy || !canCheck} onClick={check}>
            {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Check meet
          </Button>
          {preview && (
            <div className={cn("mt-3 rounded-xl border p-3", preview.results > 0 ? "border-td-green/40" : "border-td-gold/40")}>
              <div className="flex items-start justify-between gap-2">
                <div><b className="text-sm">{preview.preview.name}</b><p className="text-xs text-muted-foreground">{preview.preview.date}</p></div>
                {preview.results > 0 ? <CheckCircle2 className="h-5 w-5 text-td-green" /> : <TriangleAlert className="h-5 w-5 text-td-gold" />}
              </div>
              <div className="my-2 flex gap-5">
                {[["athletes", preview.athletes], ["marks", preview.results], ["events", preview.events], ...(preview.skipped > 0 ? [["lines skipped", preview.skipped]] : [])].map(([l, v]) => (
                  <div key={String(l)}><b className="num block text-lg">{v}</b><span className="text-[10px] text-muted-foreground">{l}</span></div>
                ))}
              </div>
              {preview.sample.slice(0, 5).map((s) => <p key={s.id} className="truncate text-[11px] text-muted-foreground">{s.name} · {s.marks.slice(0, 2).join(", ")}</p>)}
              {preview.exists ? <p className="mt-2 text-xs font-semibold text-td-gold">Already in the list.</p>
                : preview.results > 0 ? (
                  <Button className="mt-3 w-full" disabled={!!busy} onClick={add}>{busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add to projections</Button>
                ) : <p className="mt-2 text-xs text-td-gold">{preview.message}</p>}
            </div>
          )}
        </div>
        <div>
          {!b ? <Loader2 className="h-5 w-5 animate-spin text-td-green" /> : (
            <>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">{b.totals.meets} meets · {b.totals.results} marks · {b.totals.athletes} athletes{b.builtAt ? ` · refreshed ${new Date(b.builtAt).toLocaleString()}` : ""}</p>
              {b.meets.length === 0 && <p className="text-xs text-td-faint">No meets yet. Projections use this league's own results only.</p>}
              {b.meets.map((m) => (
                <div key={m.id} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                  {m.kind === "TEXT" ? <FileText className="h-4 w-4 shrink-0 text-td-green" /> : <Link2 className="h-4 w-4 shrink-0 text-td-green" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.name}</a> : m.name}</p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">{m.date} {chip(m.stat)}</div>
                  </div>
                  <button aria-label={`Remove ${m.name}`} disabled={!!busy} onClick={() => remove(m.id, m.name)} className="text-td-red/80 hover:text-td-red disabled:opacity-40">
                    {busy === `rm-${m.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <MinusCircle className="h-5 w-5" />}
                  </button>
                </div>
              ))}
              <Button variant="secondary" className="mt-3 w-full" disabled={!!busy || b.meets.length === 0} onClick={rebuild}>
                {busy === "rebuild" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Rebuild all now
              </Button>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ProjectionsTab({ onMessage }: { onMessage: (m: string) => void }) {
  const { league } = useLeague();
  const q = useQuery({ queryKey: ["admin-proj", league.id, league.version], queryFn: () => tool<ProjHealthBody>(league.id, { op: "projHealth" }) });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const h = q.data;
  if (!h) return <Loader2 className="h-6 w-6 animate-spin text-td-green" />;
  const refresh = async () => {
    if (busy) return; setBusy(true);
    try { const r = await tool<ProjHealthBody>(league.id, { op: "projHealth", refresh: true }); onMessage(r.message ?? "Refreshed."); await q.refetch(); } catch (e) { onMessage((e as Error).message); } finally { setBusy(false); }
  };
  const states = [...new Set(h.zeros.map((z) => z.state))];
  const shown = h.zeros.filter((z) => filter === "all" || z.state === filter);
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Panel title="Projection health" right={<span className="text-xs text-muted-foreground">{h.modelVersion}</span>}>
        <p className="mb-3 text-xs text-muted-foreground">Week {h.targetWeek}{h.targetWeek !== h.currentWeek ? ` (week ${h.currentWeek} is finished)` : ""} · {h.rules}</p>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {Object.keys(PROJ_STATE_LABEL).map((k) => (
            <div key={k} className="rounded-xl bg-td-surface2 p-2 text-center"><b className="num block text-lg">{h.targetWeekStates[k] ?? 0}</b><span className="text-[10px] text-muted-foreground">{PROJ_STATE_LABEL[k]}</span></div>
          ))}
        </div>
        <Row k="Athletes" v={h.athletes} /><Row k="Expected points per meet available" v={h.outlookAvailable} />
        <Button className="mt-3 w-full" disabled={busy} onClick={refresh}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh projections now</Button>
        <p className="mt-2 text-xs text-muted-foreground">Refreshing never changes real scores. Numbers can't be overridden by hand.</p>
      </Panel>
      <Panel title={`Zero or unavailable (${h.zeros.length})`} pad={false}>
        <div className="flex flex-wrap gap-2 p-3">
          {["all", ...states].map((s) => <button key={s} onClick={() => setFilter(s)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", filter === s ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground")}>{s === "all" ? "All" : PROJ_STATE_LABEL[s] ?? s}</button>)}
        </div>
        {shown.slice(0, 150).map((z) => (
          <div key={z.athleteId} className="border-t border-border px-4 py-2">
            <div className="flex justify-between text-sm"><b>{z.name}{z.team && <span className="ml-2 text-xs font-normal text-muted-foreground">{z.team}</span>}</b><span className="text-[10px] font-black uppercase text-td-gold">{z.label}</span></div>
            <p className="text-xs text-muted-foreground">{z.diagnosis}</p>
            <p className="text-[11px] text-td-faint">{z.resultsOnFile} results · {z.pbsOnFile} PBs{z.lastResult ? ` · last ${z.lastResult}` : ""}{z.outlookPerMeet != null ? ` · ${fmtPts(z.outlookPerMeet)} expected per meet` : ""}</p>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function DataTab({ onMessage }: { onMessage: (m: string) => void }) {
  const { league } = useLeague();
  const q = useQuery({ queryKey: ["admin-data", league.id, league.version], queryFn: () => tool<DataValidation>(league.id, { op: "validateData" }) });
  const d = q.data;
  if (!d) return <Loader2 className="h-6 w-6 animate-spin text-td-green" />;
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Panel title="Results check">
        <Row k="Results on file" v={d.results} />
        <Row k="Duplicate result keys" v={d.duplicateKeys} tone={d.duplicateKeys ? "red" : "green"} />
        <Row k="Athletes needing review" v={d.needsReview.athletes} tone={d.needsReview.athletes ? "gold" : undefined} />
        <Row k="Marks needing review" v={d.needsReview.marks} tone={d.needsReview.marks ? "gold" : undefined} />
        <Row k="Saved athlete links" v={d.athleteLinks} />
        <Row k="Link conflicts" v={d.linkConflicts} tone={d.linkConflicts ? "red" : "green"} />
        <Button variant="secondary" className="mt-3 w-full" disabled={q.isFetching} onClick={async () => { const r = await q.refetch(); if (r.data) onMessage(r.data.note); }}>Run validation again</Button>
        <p className="mt-2 text-xs text-muted-foreground">{d.note}</p>
      </Panel>
      <Panel title={`Meets (${d.meets.length})`} pad={false}>
        {d.meets.map((m) => (
          <div key={m.id} className="border-t border-border px-4 py-2 first:border-0">
            <div className="flex justify-between text-sm"><b className={m.ok ? "" : "text-td-gold"}>{m.name}</b><span className="text-xs text-muted-foreground">W{m.week} · {m.status}</span></div>
            <p className="text-[11px] text-td-faint">{m.date} · {m.results} results · {m.scored} scored · {m.entries} entries{m.rehearsal ? " · test meet" : ""}</p>
            {m.problems.map((p) => <p key={p} className="text-xs text-td-gold">{p}</p>)}
          </div>
        ))}
      </Panel>
    </div>
  );
}

function HistoryTab({ access, onMessage }: { access: AdminAccess; onMessage: (m: string) => void }) {
  const { league } = useLeague();
  const qc = useQueryClient();
  const v = useQuery({ queryKey: ["admin-versions", league.id, league.version], queryFn: () => tool<AdminVersions>(league.id, { op: "adminVersions" }) });
  const log = useQuery({ queryKey: ["admin-log", league.id, league.version], queryFn: () => tool<AdminChangelog>(league.id, { op: "changelog" }) });
  const [busy, setBusy] = useState(false);
  const rid = useRef(uid());
  const global = access.mode === "global";
  const restore = async (r: AdminVersionRow, source: "global" | "sandbox") => {
    if (busy) return;
    if (global) {
      if (!confirm(`Load v${r.version} into your draft? Nothing is published until you preview it and type PUBLISH on the Scoring tab.`)) return;
    } else if (prompt(`Restore ${source} v${r.version} as a new sandbox version in this test league? Type PUBLISH to confirm.`) !== "PUBLISH") return;
    setBusy(true);
    try {
      const res = global
        ? await tool<AdminResult>(league.id, { op: "draftSave", rules: r.rules })
        : await tool<AdminResult>(league.id, { op: "sandboxRestore", version: r.version, source, confirm: "PUBLISH", requestId: rid.current });
      onMessage(res.message ?? "Done.");
      if (!global) { rid.current = uid(); await qc.invalidateQueries({ queryKey: leagueKey(league.id) }); }
      await Promise.all([v.refetch(), log.refetch()]);
    } catch (e) { onMessage((e as Error).message); } finally { setBusy(false); }
  };
  const VRow = ({ r, source, live }: { r: AdminVersionRow; source: "global" | "sandbox"; live: boolean }) => (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
      <div>
        <p className="text-sm font-bold">v{r.version}{live && <span className="ml-2 rounded-full bg-td-green px-1.5 text-[10px] text-black">LIVE</span>}</p>
        <p className="text-[11px] text-muted-foreground">Participation {r.rules.participation} · PB {r.rules.pb} · SB {r.rules.sb} · 1st {r.rules.overall[0] ?? 0}</p>
        <p className="text-[11px] text-td-faint">{r.note ?? "Published"}{r.by ? ` · ${r.by}` : ""} · {new Date(r.since).toLocaleString()}</p>
      </div>
      {!live && <Button size="sm" variant="secondary" disabled={busy} onClick={() => restore(r, source)}>{global ? "Load as draft" : "Restore"}</Button>}
    </div>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Scoring versions">
        {!v.data ? <Loader2 className="h-5 w-5 animate-spin text-td-green" /> : <>
          <p className="mb-2 text-xs text-muted-foreground">Live now: {v.data.current.label}</p>
          {v.data.sandbox.length > 0 && <><p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-td-flex">Sandbox (this test league)</p>{v.data.sandbox.map((r, i) => <VRow key={`s${r.version}`} r={r} source="sandbox" live={i === 0} />)}</>}
          <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-td-gold">Global (every league)</p>
          {v.data.global.slice(0, 12).map((r, i) => <VRow key={`g${r.version}`} r={r} source="global" live={global && i === 0} />)}
          <p className="mt-2 text-xs text-muted-foreground">Restoring always creates a new version. History is never rewritten.</p>
        </>}
      </Panel>
      <Panel title="Change log" pad={false}>
        {!log.data ? <Loader2 className="m-4 h-5 w-5 animate-spin text-td-green" /> : log.data.entries.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No changes yet.</p> : log.data.entries.slice(0, 100).map((e, i) => (
          <div key={i} className="flex gap-3 border-t border-border px-4 py-2 first:border-0">
            <span className={cn("w-16 shrink-0 pt-0.5 text-[10px] font-black uppercase", e.kind === "publish" || e.kind === "restore" ? "text-td-gold" : e.kind === "draft" || e.kind === "preview" ? "text-td-flex" : "text-td-green")}>{e.kind}</span>
            <div><p className="text-sm">{e.text}</p><p className="text-[11px] text-td-faint">{e.by} · {new Date(e.at).toLocaleString()} · {e.scope}</p></div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

