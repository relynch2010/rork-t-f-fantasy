import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Clock, Plus, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { AthleteAvatar, PageHeader, Panel, PosTag, StatusTag } from "@/components/td";
import { useLeague, useLeagueExtra } from "@/lib/league";
import { fmtPts, PROJ_STATE_SHORT, type RankRow, type RankingsBody } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlayerDialog } from "./PlayerDialog";

type Filter = "all" | "available" | "freeAgents" | "waivers" | "rostered";
type Sort = "projected" | "recent" | "seasonAvg" | "season" | "week";

const SORTS: [Sort, string][] = [["projected", "Projected"], ["recent", "Recent (3 wk)"], ["seasonAvg", "Season avg"], ["season", "Season pts"], ["week", "This week"]];

const recentAvg = (r?: RankRow): number => {
  const played = (r?.recent ?? []).filter((x) => x.played).map((x) => x.points);
  return played.length ? played.reduce((a, b) => a + b, 0) / played.length : 0;
};

export function ReviewMark() {
  return <span title="Needs review: a possible result is waiting for the commissioner" className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-td-gold text-[10px] font-black text-black">?</span>;
}

/** Yahoo-style players list: yellow + = waivers (claim), green + = free agent (instant add), with rankings and projections. */
export default function Players() {
  const { league, team } = useLeague();
  const [q, setQ] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("available");
  const [pos, setPos] = useState<string>("ALL");
  const [gender, setGender] = useState<string>("X");
  const [event, setEvent] = useState<string>("");
  const [sort, setSort] = useState<Sort>("projected");
  const [card, setCard] = useState<string | null>(null);
  const projWeek = league.phase === "season" ? (league.nextWeekAt ? league.week + 1 : league.week) : 1;
  const ranks = useLeagueExtra<RankingsBody>(["rankings", projWeek], `/leagues/${league.id}/projections?week=${projWeek}&rankings=1`);
  const rankMap = useMemo(() => new Map((ranks.data?.rows ?? []).map((r) => [r.athleteId, r])), [ranks.data]);
  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of league.teams) for (const id of t.roster) m.set(id, t.id);
    return m;
  }, [league.teams]);
  const amap = useMemo(() => new Map(league.athletes.map((a) => [a.id, a])), [league.athletes]);
  const week = league.phase === "season" ? league.week : Math.max(1, league.lastCompletedWeek);
  const events = useMemo(() => [...new Set((ranks.data?.rows ?? []).flatMap((r) => r.events))].sort(), [ranks.data]);
  const season = (id: string): number => Object.values(league.points[id] ?? {}).reduce((x, y) => x + y, 0);

  const rows = useMemo(() => {
    const list = league.rankings
      .map((id) => amap.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()) || (a.school ?? "").toLowerCase().includes(q.toLowerCase()))
      .filter((a) => pos === "ALL" || (pos === "FLEX" ? a.flex : a.positions.includes(pos)))
      .filter((a) => gender === "X" || a.gender === gender)
      .filter((a) => !event || (rankMap.get(a.id)?.events ?? []).includes(event))
      .filter((a) => {
        const o = owner.has(a.id);
        const w = !!league.waivers[a.id];
        if (filter === "all") return true;
        if (filter === "rostered") return o;
        if (filter === "waivers") return !o && w;
        if (filter === "freeAgents") return !o && !w;
        return !o;
      });
    const key = (id: string): number => {
      const r = rankMap.get(id);
      if (sort === "projected") return r?.projected ?? -1;
      if (sort === "recent") return recentAvg(r);
      if (sort === "seasonAvg") return r?.seasonAvg ?? -1;
      if (sort === "season") return season(id);
      return league.points[id]?.[String(week)] ?? 0;
    };
    return [...list].sort((a, b) => key(b.id) - key(a.id)).slice(0, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.rankings, amap, q, pos, gender, event, filter, owner, league.waivers, rankMap, sort, week, league.points]);

  const chip = (label: string, on: boolean, click: () => void) => (
    <button key={label} onClick={click} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold transition", on ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground hover:text-foreground")}>{label}</button>
  );
  const inSeason = league.phase === "season";

  return (
    <div>
      <PageHeader title="Players" sub="Rankings are recommendations only. They never change waiver priority or claim order." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search athletes or schools" className="pl-9" />
        </div>
        {([["available", "Available"], ["freeAgents", "Free agents"], ["waivers", "Waivers"], ["rostered", "Rostered"], ["all", "All"]] as [Filter, string][]).map(([f, l]) => chip(l, filter === f, () => setFilter(f)))}
        <span className="mx-1 h-6 w-px bg-border" />
        {["ALL", "SPR", "DIS", "FLD", "FLEX"].map((p) => chip(p, pos === p, () => setPos(p)))}
        <span className="mx-1 h-6 w-px bg-border" />
        {[["X", "All"], ["B", "Boys"], ["G", "Girls"]].map(([g, l]) => chip(l, gender === g, () => setGender(g)))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">Sort
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-muted-foreground">Event
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">All events</option>
            {events.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="grid h-5 w-5 place-items-center rounded-full border-2 border-td-waiver text-td-waiver"><Plus className="h-3 w-3" /></span>Waivers · claim</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="grid h-5 w-5 place-items-center rounded-full border-2 border-td-green text-td-green"><Plus className="h-3 w-3" /></span>Free agent · add now</span>
        {ranks.data && <span className="ml-auto text-xs text-td-faint">Week {projWeek} projections · {ranks.data.modelVersion}{ranks.data.accuracy?.withEntries ? ` · back-tested ±${fmtPts(ranks.data.accuracy.withEntries.mae)} pts` : ""}</span>}
      </div>
      <Panel pad={false}>
        <div className="grid grid-cols-[36px_1fr_auto_auto_auto] gap-3 border-b border-border px-4 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-td-faint">
          <span /><span>Athlete</span><span className="hidden w-36 md:block">Status</span><span className="w-24 text-right">Proj wk {projWeek}</span><span className="w-28 text-right">Actual</span>
        </div>
        {rows.map((a) => {
          const r = rankMap.get(a.id);
          const tid = owner.get(a.id);
          const onWaivers = !tid && !!league.waivers[a.id];
          const claimed = league.claims.some((c) => c.status === "pending" && c.addId === a.id);
          return (
            <div key={a.id} className="grid w-full grid-cols-[36px_1fr_auto_auto_auto] items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-0 hover:bg-td-surface2/60">
              {inSeason && !tid ? (
                <button onClick={() => setCard(a.id)} title={onWaivers ? "On waivers: place a claim" : "Free agent: add now"} className={cn("grid h-8 w-8 place-items-center rounded-full border-2 transition hover:scale-105", onWaivers ? "border-td-waiver text-td-waiver" : "border-td-green text-td-green")}>
                  {claimed ? <Clock className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </button>
              ) : <span />}
              <button onClick={() => setCard(a.id)} className="flex min-w-0 items-center gap-3 text-left">
                <AthleteAvatar athlete={a} size={34} />
                <span className="min-w-0"><span className="flex items-center gap-2 truncate font-semibold">{a.name}{(league.reviewFlags?.[a.id] ?? 0) > 0 && <ReviewMark />}<StatusTag status={a.status} /></span><span className="flex items-center gap-2 text-xs text-muted-foreground"><PosTag position={a.position} />{a.gender === "G" ? "G" : "B"}{r?.events.length ? ` • ${r.events.slice(0, 3).join(", ")}` : a.school ? ` • ${a.school}` : ""}</span></span>
              </button>
              <span className="hidden w-36 truncate text-sm md:block">{tid ? <span className={tid === league.me ? "text-td-green" : "text-muted-foreground"}>{team(tid)?.teamName}</span> : onWaivers ? <span className="text-td-waiver">Waivers</span> : <span className="text-td-green">Free agent</span>}</span>
              <span className="w-24 text-right">
                <span className="flex items-center justify-end gap-1.5"><span className="rounded-full border border-dashed border-muted-foreground px-1.5 text-[9px] font-black tracking-wider text-muted-foreground">PROJ</span>{r && r.projected === 0 && r.state && PROJ_STATE_SHORT[r.state] ? <span className={cn("text-xs font-black", r.state === "insufficient" ? "text-td-gold" : "text-td-faint")} title={r.stateLabel}>{PROJ_STATE_SHORT[r.state]}</span> : <span className="num text-lg text-muted-foreground">{r ? fmtPts(r.projected) : "–"}</span>}</span>
                {r?.state === "noMeet" && r.outlookPerMeet != null && <span className="block text-[10px] text-td-faint">~{fmtPts(r.outlookPerMeet)} per meet</span>}
                {r?.confidence && <span className={cn("text-[10px] font-bold", r.confidence === "High" ? "text-td-green" : r.confidence === "Medium" ? "text-td-gold" : "text-td-faint")}>{r.confidence}</span>}
              </span>
              <span className="w-28 text-right">
                <span className="num text-lg">{sort === "recent" ? fmtPts(recentAvg(r)) : sort === "seasonAvg" ? (r?.seasonAvg != null ? fmtPts(r.seasonAvg) : "–") : sort === "week" ? fmtPts(league.points[a.id]?.[String(week)] ?? 0) : fmtPts(season(a.id))}</span>
                <span className="flex items-center justify-end gap-1 text-[10px] text-td-faint">
                  {r?.trend != null && (r.trend >= 0 ? <ArrowUpRight className="h-3 w-3 text-td-green" /> : <ArrowDownRight className="h-3 w-3 text-td-red" />)}
                  {sort === "recent" ? "last 3 wk avg" : sort === "seasonAvg" ? `${r?.weeksPlayed ?? 0} wk played` : sort === "week" ? `week ${week}` : "season"}
                </span>
              </span>
            </div>
          );
        })}
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No athletes match.</p>}
      </Panel>
      <PlayerDialog athleteId={card} onClose={() => setCard(null)} />
    </div>
  );
}
