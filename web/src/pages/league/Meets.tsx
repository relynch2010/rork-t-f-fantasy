import { useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Pause, Play, Plus, Radio, XOctagon } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, LiveDot, MainLeagueBanner, PageHeader, Panel } from "@/components/td";
import { LabSummary, type LabResult } from "@/components/LabSummary";
import { api } from "@/lib/api";
import { useLeague } from "@/lib/league";
import { timeAgo, type Meet } from "@/lib/types";
import { cn } from "@/lib/utils";


export default function Meets() {
  const { league, act, busy } = useLeague();
  const can = league.canEditGlobal;
  const [editing, setEditing] = useState<Meet | "new" | null>(null);
  const meets = [...league.meets].sort((a, b) => b.week - a.week || b.createdAt - a.createdAt);
  const anyPolling = league.meets.some((m) => m.polling);
  const anyPaused = league.meets.some((m) => m.scope === "global" && m.status === "LIVE" && !m.polling);

  const status = (m: Meet) => (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-black", m.status === "LIVE" ? "bg-td-red/15 text-td-red" : m.status === "FINAL" ? "bg-td-surface2 text-muted-foreground" : "bg-td-green/15 text-td-green")}>
      {m.status === "LIVE" && <LiveDot />}{m.status}
    </span>
  );

  return (
    <div>
      <PageHeader title="Meets" sub="Global meets shared by every league. Each league scores them against its own rosters and lineups." right={can ? (
        <>
          {anyPolling
            ? <Button variant="secondary" className="rounded-full" disabled={busy} onClick={() => confirm("Pause live scoring for every live meet in every league? Scores are kept.") && act({ type: "pauseAllLive" }, "Live scoring paused")}><Pause /> Pause all live</Button>
            : anyPaused && <Button variant="secondary" className="rounded-full" disabled={busy} onClick={() => act({ type: "resumeAllLive" }, "Live scoring resumed")}><Play /> Resume live</Button>}
          <Link to={`/league/${league.id}/lab`} className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold hover:bg-td-surface2"><FlaskConical className="h-4 w-4" /> Test Lab</Link>
          <Button className="rounded-full font-bold" onClick={() => setEditing("new")}><Plus /> Add meet</Button>
        </>
      ) : undefined} />
      {!can && <div className="mb-5"><MainLeagueBanner>Meets, links, status and live scoring are controlled by the Main League for every league.</MainLeagueBanner></div>}
      {meets.length === 0 ? <Empty icon={<Radio className="h-9 w-9" />} title="No meets yet">{can ? "Add this week's meet with its AthleticLIVE link." : "The Main League hasn't added a meet yet."}</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {meets.map((m) => {
            const editable = m.scope === "global" ? can : league.commissionerId === league.viewerId;
            return (
              <Panel key={m.id} title={<span className="flex items-center gap-2">Week {m.week}{m.archived && <span className="text-td-faint">• Archived</span>}</span>} right={status(m)}>
                <p className="font-display text-3xl">{m.name}</p>
                <p className="text-sm text-muted-foreground">{m.date || "No date"} • {m.provider === "MANUAL" ? "Pasted feed" : "AthleticLIVE"}{m.lastSyncedAt ? ` • updated ${timeAgo(m.lastSyncedAt)}` : ""}</p>
                {m.sourceUrl && <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{m.sourceUrl}</p>}
                {m.sourceInfo && <p className="mt-1 flex items-start gap-1.5 text-xs text-td-green"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Verified: {m.sourceInfo.name} · {m.sourceInfo.date} · {m.sourceInfo.location}</p>}
                {m.resolve && <p className={cn("mt-2 flex items-start gap-1.5 text-xs", m.resolve.ok ? "text-td-green" : "text-td-gold")}>{m.resolve.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}{m.resolve.message}</p>}
                {m.sourceError && <p className="mt-2 flex items-start gap-1.5 text-xs text-td-red"><XOctagon className="h-3.5 w-3.5 shrink-0" />{m.sourceError}</p>}
                {m.lastTest && <p className="mt-2 text-xs text-muted-foreground">Last test {timeAgo(m.lastTest.at)}: {m.lastTest.ok ? "passed" : "failed"} • {m.lastTest.results} results • {m.lastTest.matched} matched</p>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[["Results", m.stats.processed], ["Matched", m.stats.matched], ["Scored", m.stats.scored]].map(([l, v]) => <div key={l} className="rounded-lg bg-td-surface2 py-2"><p className="num text-2xl">{v}</p><p className="text-[10px] font-bold uppercase text-td-faint">{l}</p></div>)}
                </div>
                {m.archived && <p className="mt-3 text-xs text-muted-foreground">League-only meet from before global meets. Its points are kept, but it no longer runs.</p>}
                {editable && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!m.archived && (m.polling
                      ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => act({ type: "stopLive", meetId: m.id }, "Live scoring stopped")}>Stop live scoring</Button>
                      : m.status !== "FINAL" && <Button size="sm" disabled={busy} onClick={() => act({ type: "startLive", meetId: m.id }, "Live scoring is on for every league")}>Start live scoring</Button>)}
                    {!m.archived && <Button size="sm" variant="secondary" disabled={busy} onClick={() => act({ type: "syncMeet", meetId: m.id }, "Results checked")}>Check now</Button>}
                    {!m.archived && m.scope === "global" && m.status !== "UPCOMING" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => confirm("Re-read the source and rebuild this meet's results in every league? Results are replaced, never added twice.") && act({ type: "reprocessMeet", meetId: m.id }, "Reprocessing in every league")}>Reprocess</Button>}
                    {!m.archived && (m.status === "FINAL"
                      ? <Button size="sm" variant="secondary" onClick={() => act({ type: "reopenMeet", meetId: m.id }, "Meet reopened")}>Reopen</Button>
                      : <Button size="sm" variant="secondary" onClick={() => confirm("Mark this meet final for every league?") && act({ type: "markFinal", meetId: m.id }, "Meet is final")}>Mark final</Button>)}
                    {!m.archived && <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Edit</Button>}
                    <Button size="sm" variant="ghost" className="text-td-red" disabled={m.polling} onClick={() => confirm("Delete this meet and every point it produced?") && act({ type: "deleteMeet", meetId: m.id, removeScores: true }, "Meet deleted")}>Delete</Button>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
      {editing && <MeetEditor meet={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MeetEditor({ meet, onClose }: { meet: Meet | null; onClose: () => void }) {
  const { league, act, busy } = useLeague();
  const [name, setName] = useState<string>(meet?.name ?? "");
  const [date, setDate] = useState<string>(meet?.date ?? new Date().toISOString().slice(0, 10));
  const [week, setWeek] = useState<number>(meet?.week ?? league.week);
  const [provider, setProvider] = useState<string>(meet?.provider ?? "ATHLETICLIVE");
  const [sourceUrl, setSourceUrl] = useState<string>(meet?.sourceUrl ?? "");
  const [eventsUrl, setEventsUrl] = useState<string>(meet?.eventsUrl ?? "");
  const [rosterUrl, setRosterUrl] = useState<string>(meet?.rosterUrl ?? "");
  const [resultsUrl, setResultsUrl] = useState<string>(meet?.resultsUrl ?? "");
  const [advanced, setAdvanced] = useState<boolean>(!!meet && !meet.sourceUrl && !!meet.resultsUrl);
  const [test, setTest] = useState<LabResult | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  const fields = { name, date, week, provider, sourceUrl, eventsUrl, rosterUrl, resultsUrl };

  const runTest = async (): Promise<void> => {
    setTesting(true); setTest(null);
    try { setTest(await api<LabResult>(`/leagues/${league.id}/meet-test`, { body: { ...fields, meetId: meet?.id ?? "" } })); }
    catch (e) { toast.error((e as Error).message); }
    finally { setTesting(false); }
  };
  const save = async (): Promise<void> => {
    const ok = meet ? await act({ type: "updateMeet", meetId: meet.id, ...fields }, "Meet saved for every league") : await act({ type: "createMeet", ...fields }, "Meet added for every league");
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-3xl">{meet ? "Edit meet" : "Add meet"}</DialogTitle></DialogHeader>
        <p className="rounded-xl bg-td-gold/10 p-3 text-xs text-td-gold">Global meet: every league sees this meet, its links and its status.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Meet name</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Fantasy week</Label><Input type="number" min={1} max={30} value={week} onChange={(e) => setWeek(Number(e.target.value))} /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Provider</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={provider} onChange={(e) => { setProvider(e.target.value); setTest(null); }}>
              <option value="ATHLETICLIVE">AthleticLIVE</option>
            </select>
          </div>
        </div>
        {provider === "ATHLETICLIVE" && (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>AthleticLIVE meet link</Label><Input className="font-mono" placeholder="https://live.athletic.net/meets/…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} /></div>
            {meet?.resolve && <p className={cn("text-xs", meet.resolve.ok ? "text-td-green" : "text-td-gold")}>{meet.resolve.message}</p>}
            <button className="text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={() => setAdvanced(!advanced)}>{advanced ? "▾" : "▸"} Advanced (optional): override one dataset</button>
            {advanced && (
              <div className="space-y-2 rounded-xl bg-td-surface2 p-3">
                {[["Advanced Events URL", eventsUrl, setEventsUrl], ["Advanced Roster URL", rosterUrl, setRosterUrl], ["Advanced Results URL", resultsUrl, setResultsUrl]].map(([l, v, set]) => (
                  <div key={l as string} className="space-y-1"><Label className="text-xs">{l as string}</Label><Input className="font-mono text-xs" value={v as string} onChange={(e) => (set as (s: string) => void)(e.target.value)} placeholder="https://" /></div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Paste the meet's normal public AthleticLIVE link. The server finds and verifies the meet's events, athletes and results itself. Advanced links are optional; each one replaces only its own part.</p>
          </div>
        )}
        <Button variant="secondary" onClick={runTest} disabled={testing || (provider === "ATHLETICLIVE" && !sourceUrl && !resultsUrl)}>{testing && <Loader2 className="animate-spin" />} Test connection</Button>
        {test && <LabSummary result={test} />}
        <DialogFooter><Button className="font-bold" disabled={busy || !name.trim()} onClick={save}>{meet ? "Save changes" : "Save meet"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
