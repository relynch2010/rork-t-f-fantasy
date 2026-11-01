import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Crown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MainLeagueBanner, PageHeader, Panel } from "@/components/td";
import { api } from "@/lib/api";
import { leagueKey, useLeague } from "@/lib/league";
import { WEEKDAYS, type GameSettings, type GlobalSetup, type ScoringRules } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Unseeded-section brackets (only athletes in an Unseeded section, ranked within it). */
const UNSEEDED_DEFAULT = [0.05, 0.1, 0.2, 0.3, 0.4].map((pct) => ({ pct, pts: 0 }));

type LeagueRow = { leagueId: string; name: string; code: string; isMainLeague: boolean; upToDate: boolean; shapePending: boolean };

/** Main League commissioner: the one global setup. Saved through the website's own route; the server checks permission. */
export default function GlobalSettings() {
  const { league } = useLeague();
  const qc = useQueryClient();
  const g = league.global;
  const can = league.canEditGlobal;
  const [rules, setRules] = useState<ScoringRules | null>(g?.rules ?? null);
  const [game, setGame] = useState<GameSettings | null>(g?.settings ?? null);
  const [roster, setRoster] = useState<GlobalSetup["roster"] | null>(g?.roster ?? null);
  const [live, setLive] = useState<GlobalSetup["live"] | null>(g?.live ?? null);
  const [notices, setNotices] = useState<GlobalSetup["notices"] | null>(g?.notices ?? null);
  const [saving, setSaving] = useState<boolean>(false);
  const leagues = useQuery({ queryKey: ["global-leagues", g?.version], queryFn: () => api<{ leagues: LeagueRow[] }>("/global/leagues"), enabled: can });

  useEffect(() => {
    if (!g) return;
    setRules(g.rules); setGame(g.settings); setRoster(g.roster); setLive(g.live); setNotices(g.notices);
  }, [g]);

  const save = async (action: Record<string, unknown>, msg: string): Promise<void> => {
    setSaving(true);
    try {
      await api("/global/action", { body: action });
      toast.success(msg);
      // The server pushes the new setup to every league; pull ours right away.
      window.setTimeout(() => qc.invalidateQueries({ queryKey: leagueKey(league.id) }), 600);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!g || !rules || !game || !roster || !live || !notices) return <p className="text-muted-foreground">Global setup is loading…</p>;
  const dis = !can || saving;
  const num = (v: number, set: (n: number) => void, step = 0.5) => (
    <input type="number" step={step} value={v} disabled={dis} onChange={(e) => set(Number(e.target.value))} className="num h-9 w-20 rounded-lg border border-input bg-background px-2 text-center text-lg disabled:opacity-60" />
  );
  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <div><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>{control}
    </div>
  );
  const list = (key: "overall" | "relay" | "heat") => (
    <div className="flex gap-1.5">
      {rules[key].map((v, i) => (
        <input key={i} type="number" step={0.5} value={v} disabled={dis} onChange={(e) => { const next = [...rules[key]]; next[i] = Number(e.target.value); setRules({ ...rules, [key]: next }); }}
          className="num h-9 w-12 rounded-lg border border-input bg-background text-center text-base disabled:opacity-60" />
      ))}
    </div>
  );
  const select = <K extends keyof GameSettings>(k: K, opts: [GameSettings[K], string][]) => (
    <select disabled={dis} value={String(game[k])} onChange={(e) => { const hit = opts.find(([v]) => String(v) === e.target.value); if (hit) setGame({ ...game, [k]: hit[0] }); }}
      className="h-9 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-60">
      {opts.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
    </select>
  );
  const gnum = (k: keyof GameSettings, step = 1) => num(game[k] as number, (n) => setGame({ ...game, [k]: n }), step);

  return (
    <div>
      <PageHeader
        eyebrow={<span className="flex items-center gap-1.5 text-td-gold"><Crown className="h-3.5 w-3.5" /> Main League • {league.mainLeagueCode}</span> as unknown as string}
        title={can ? "Global Game Settings" : "Game Rules"}
        sub={`Version ${g.version} • updated ${new Date(g.updatedAt).toLocaleString()} by ${g.updatedBy}`}
      />
      {!can && <div className="mb-5"><MainLeagueBanner>Every league uses these rules. Only the Main League commissioner can change them.</MainLeagueBanner></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Scoring" right={can && <Button size="sm" disabled={saving} onClick={() => save({ type: "updateScoring", rules }, "Scoring saved for every league")}>Save</Button>}>
          {row("Participation", num(rules.participation, (n) => setRules({ ...rules, participation: n })))}
          {row("Personal best (PB)", num(rules.pb, (n) => setRules({ ...rules, pb: n })))}
          {row("Season best (SB)", num(rules.sb, (n) => setRules({ ...rules, sb: n })))}
          {row("PB that's also an SB", <span className="text-sm font-semibold text-muted-foreground">PB points only (never stacked)</span>)}
          {row("Individual place 1st–6th", list("overall"))}
          {row("Relay place 1st–6th", list("relay"))}
          {row("Heat / flight 1st–3rd", list("heat"))}
          {rules.percentile.map((t, i) => row(`Top ${Math.round(t.pct * 100)}% of seeded field`, num(t.pts, (n) => { const p = [...rules.percentile]; p[i] = { ...t, pts: n }; setRules({ ...rules, percentile: p }); })))}
          {(rules.percentileUnseeded ?? UNSEEDED_DEFAULT).map((t, i) => row(`Top ${Math.round(t.pct * 100)}% of unseeded section`, num(t.pts, (n) => { const p = [...(rules.percentileUnseeded ?? UNSEEDED_DEFAULT)]; p[i] = { ...t, pts: n }; setRules({ ...rules, percentileUnseeded: p }); })))}
          {row("Standards cap per season", num(rules.standardCap, (n) => setRules({ ...rules, standardCap: n })))}
          {row("School record", num(rules.schoolRecord, (n) => setRules({ ...rules, schoolRecord: n })))}
          {row("Baton fumble", num(rules.fumble, (n) => setRules({ ...rules, fumble: n })))}
          {row("DQ / DNF", num(rules.dqdnf, (n) => setRules({ ...rules, dqdnf: n })))}
          <p className="mt-3 text-xs text-muted-foreground">Applies to the current week and later in every league. Finished weeks keep the points they were scored with. Standards and performance tables are edited in the app's Commissioner Tools and shared the same way.</p>
        </Panel>
        <div className="space-y-5">
          <Panel title="Game rules" right={can && <Button size="sm" disabled={saving} onClick={() => save({ type: "updateGlobalSettings", settings: game }, "Game rules saved for every league")}>Save</Button>}>
            {row("Pick timer (sec)", gnum("pickSeconds", 15))}
            {row("Regular season weeks", gnum("regularWeeks"), "Drafted leagues switch at their next season")}
            {row("Playoff teams", select("playoffTeams", [[0, "No playoffs"], [2, "2"], [4, "4"], [6, "6"], [8, "8"]]))}
            {row("Consolation bracket", <Switch disabled={dis} checked={game.consolation} onCheckedChange={(v) => setGame({ ...game, consolation: v })} />)}
            {row("Tiebreaker", select("tiebreaker", [["pf", "Points for"], ["h2h", "Head-to-head"]]))}
            {row("Waiver type", select("waiverType", [["rolling", "Rolling priority"], ["faab", "Budget bidding"]]))}
            {row("Waiver schedule", select("waiverSchedule", [["weekly", "Weekly run (Yahoo)"], ["daily", "Days after drop"]]))}
            {(game.waiverSchedule ?? "weekly") === "weekly"
              ? row("Waiver day", select("waiverDay", [0, 1, 2, 3, 4, 5, 6].map((d) => [d, WEEKDAYS[d] as string] as [number, string])))
              : row("Days on waivers", gnum("waiverDays"))}
            {row("Process claims at (hour, ET)", gnum("waiverHour"))}
            {row("Waiver budget ($)", gnum("faabBudget", 10))}
            {row("Weekly add limit (0 = none)", gnum("maxAddsPerWeek"))}
            {row("Trade review", select("tradeReview", [["commish", "Commissioner"], ["league", "League vote"], ["none", "None"]]))}
            {row("Review days", gnum("tradeReviewDays"))}
            {row("Veto votes needed", gnum("vetoVotes"))}
            {row("Trade deadline week (0 = none)", gnum("tradeDeadlineWeek"))}
            {row("Lineup lock", select("lineupLock", [["results", "When each event starts"], ["manual", "Commissioner locks"]]))}
          </Panel>
          <Panel title="Roster & positions" right={can && <Button size="sm" disabled={saving} onClick={() => save({ type: "updateRoster", roster }, "Roster rules saved for every league")}>Save</Button>}>
            {row("Spots", <span className="text-sm font-semibold">SPR • DIS • FLD • FLEX • BN • BN • IR</span>)}
            {row("Allow the IR spot", <Switch disabled={dis} checked={roster.irSlot} onCheckedChange={(v) => setRoster({ ...roster, irSlot: v })} />)}
            {[["IR", "Injured Reserve"], ["O", "Out"], ["Q", "Questionable"]].map(([c, l]) => row(`${l} can use IR`, <Switch disabled={dis || !roster.irSlot} checked={roster.irStatuses.includes(c)} onCheckedChange={(v) => setRoster({ ...roster, irStatuses: v ? [...roster.irStatuses, c] : roster.irStatuses.filter((x) => x !== c) })} />))}
            {[["SPR", "Sprinters"], ["DIS", "Distance"], ["FLD", "Field"]].map(([c, l]) => row(`${l} can play FLEX`, <Switch disabled={dis} checked={roster.flexPositions.includes(c)} onCheckedChange={(v) => { const next = v ? [...roster.flexPositions, c] : roster.flexPositions.filter((x) => x !== c); if (next.length) setRoster({ ...roster, flexPositions: next }); }} />))}
          </Panel>
          <Panel title="Live scoring & notifications" right={can && <Button size="sm" disabled={saving} onClick={async () => { await save({ type: "updateLive", live }, "Live settings saved"); await save({ type: "updateNotices", notices }, "Alert rules saved"); }}>Save</Button>}>
            {row("Check results every (sec)", num(live.pollSeconds, (n) => setLive({ ...live, pollSeconds: n }), 5))}
            {row("Auto-final after quiet minutes", num(live.autoFinalMinutes, (n) => setLive({ ...live, autoFinalMinutes: n }), 5))}
            {row("Pause live after (hours)", num(live.maxLiveHours, (n) => setLive({ ...live, maxLiveHours: n }), 1))}
            {(Object.keys(notices) as (keyof GlobalSetup["notices"])[]).map((k) => row(`Send ${k} alerts`, <Switch disabled={dis} checked={notices[k]} onCheckedChange={(v) => setNotices({ ...notices, [k]: v })} />))}
          </Panel>
        </div>
      </div>
      {can && leagues.data && (
        <Panel title={`Leagues (${leagues.data.leagues.length})`} className="mt-5" pad={false}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3">
            {leagues.data.leagues.map((l) => (
              <div key={l.leagueId} className="flex items-center gap-3 border-b border-r border-border px-4 py-3">
                {l.isMainLeague ? <Crown className="h-4 w-4 text-td-gold" /> : l.upToDate ? <CheckCircle2 className="h-4 w-4 text-td-green" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{l.name}</p><p className={cn("text-xs", l.shapePending ? "text-td-gold" : "text-muted-foreground")}>{l.code} • {l.upToDate ? "Up to date" : "Updating…"}{l.shapePending ? " • season shape at next draft" : ""}</p></div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
