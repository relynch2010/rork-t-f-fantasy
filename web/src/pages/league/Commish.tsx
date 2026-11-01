import { useState } from "react";
import { CalendarDays, Crown, FlaskConical, UserX } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Panel, TeamAvatar } from "@/components/td";
import { useLeague } from "@/lib/league";

export default function Commish() {
  const { league, team, athlete, act, busy, isCommish } = useLeague();
  const [applyFinal, setApplyFinal] = useState<Record<string, boolean>>({});
  if (!isCommish) return <Empty title="Commissioner only" />;
  const pre = league.phase === "predraft";
  const finalWeekOf = (meetId: string): number | null => {
    const m = league.meets.find((x) => x.id === meetId);
    if (!m) return null;
    const games = league.schedule.filter((g) => g.week === m.week);
    return games.length > 0 && games.every((g) => g.final) ? m.week : null;
  };
  return (
    <div>
      <PageHeader title="Commissioner Tools" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Panel title="This week">
            <div className="flex flex-wrap gap-2">
              {league.phase === "season" && <Button variant="secondary" disabled={busy} onClick={() => confirm("Finalize this week? Only for weeks without a meet.") && act({ type: "finalizeWeek" }, "Week finalized")}>Finalize week {league.week}</Button>}
              {league.phase === "season" && Object.keys(league.waivers).length > 0 && <Button variant="secondary" disabled={busy} onClick={() => act({ type: "runWaivers" }, "Waivers processed")}>Process waivers now</Button>}
              {league.phase === "season" && league.settings.lineupLock === "manual" && <Button variant="secondary" onClick={() => act({ type: "lockLineups" }, "Lineups locked")}>Lock lineups</Button>}
              {league.phase === "season" && league.nextWeekAt && <Button variant="secondary" disabled={busy} onClick={() => confirm("Show next week's matchup now instead of Monday 12:00 AM ET?") && act({ type: "startNextWeek" }, "Next week is live")}>Activate week {league.week + 1} now</Button>}
            </div>
            {league.nextWeekAt && <p className="mt-2 text-xs text-td-green">Week {league.week} is final. Week {league.week + 1} activates {new Date(league.nextWeekAt).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}.</p>}
            <p className="mt-2 text-xs text-muted-foreground">Weeks with a meet close automatically when the Main League marks that meet final.</p>
          </Panel>
          <Panel title="Season & scoring tools">
            <div className="grid gap-2 sm:grid-cols-2">
              {league.phase !== "predraft" && league.phase !== "drafting" && (
                <Link to={`/league/${league.id}/schedule`} className="flex items-center gap-3 rounded-xl bg-td-surface2 p-3 hover:bg-td-raised"><CalendarDays className="h-5 w-5 text-td-green" /><span><b className="block text-sm">Season schedule</b><span className="text-xs text-muted-foreground">Matchups, checks, confirmed changes</span></span></Link>
              )}
              <Link to={`/league/${league.id}/scoring-lab`} className="flex items-center gap-3 rounded-xl bg-td-surface2 p-3 hover:bg-td-raised"><FlaskConical className="h-5 w-5 text-td-gold" /><span><b className="block text-sm">Scoring lab</b><span className="text-xs text-muted-foreground">Seeded/unseeded, relays, accuracy</span></span></Link>
            </div>
          </Panel>
          <Panel title="Teams" pad={false}>
            {league.teams.map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                <TeamAvatar team={t} leagueId={league.id} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold">{t.teamName}{t.id === league.commissionerId && <Crown className="h-4 w-4 text-td-gold" />}</p>
                  <p className="text-xs text-muted-foreground">{t.ownerName}{t.coManagerName ? ` • co-manager ${t.coManagerName}` : ""}</p>
                </div>
                {t.id !== league.commissionerId && <>
                  <Button size="sm" variant="ghost" onClick={() => confirm(`Make ${t.ownerName} commissioner? You'll lose these tools.`) && act({ type: "setCommissioner", teamId: t.id }, "Commissioner changed")}>Make commish</Button>
                  {pre && <Button size="icon" variant="ghost" title="Remove team" onClick={() => confirm(`Remove ${t.teamName}?`) && act({ type: "removeTeam", teamId: t.id }, "Team removed")}><UserX /></Button>}
                </>}
              </div>
            ))}
          </Panel>
        </div>
        <Panel title={`Unmatched results (${league.unmatchedCount})`} pad={false}>
          {league.unmatched.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nothing to review. Results the server can't confidently match show up here. Nothing is ever guessed.</p> : (
            <div className="max-h-[680px] overflow-y-auto">
              {league.unmatched.map((u) => {
                const fw = finalWeekOf(u.meetId);
                return (
                  <div key={u.id} className="border-b border-border p-4 last:border-0">
                    {(u.kind === "athlete" || u.kind === "relay") && <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black tracking-wider text-td-gold"><span className="grid h-4 w-4 place-items-center rounded-full bg-td-gold text-[10px] text-black">?</span>NEEDS REVIEW · NO POINTS UNTIL YOU DECIDE</p>}
                    <div className="flex justify-between gap-2"><p className="font-semibold">{u.sourceName}</p>{u.relevant && <span className="text-[10px] font-black text-td-gold">ON A ROSTER</span>}</div>
                    <p className="text-xs text-muted-foreground">{u.school} • {u.eventName} • {u.result}</p>
                    {u.kind === "athlete" && fw !== null && (
                      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!applyFinal[u.id]} onChange={(e) => setApplyFinal({ ...applyFinal, [u.id]: e.target.checked })} />Also correct the final Week {fw} matchup (otherwise only player totals update)</label>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {u.kind === "athlete" && u.candidates.map((c) => (
                        <span key={c} className="flex items-center gap-1">
                          <Button size="sm" onClick={() => act({ type: "confirmMatch", unmatchedId: u.id, athleteId: c, ...(applyFinal[u.id] ? { applyToFinal: true } : {}) }, "Match confirmed. Points updated.")}>Confirm: {athlete(c)?.name}</Button>
                          <Button size="sm" variant="ghost" className="text-td-red" onClick={() => act({ type: "rejectMatch", unmatchedId: u.id, athleteId: c }, "Noted")}>Not them</Button>
                        </span>
                      ))}
                      <Button size="sm" variant="ghost" onClick={() => act({ type: "rejectMatch", unmatchedId: u.id }, "Dismissed")}>Not a fantasy athlete</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
      {(league.phase !== "predraft" || league.draft.picks.length > 0) && (
        <Panel title="Danger zone" className="mt-5 border-td-red/30">
          <p className="text-sm text-muted-foreground">Reset Draft erases draft picks, drafted rosters and the schedule for this league only. Members, team names, global settings, players and every other league stay the same. A backup is saved first.</p>
          <Button className="mt-3" variant="destructive" disabled={busy} onClick={() => {
            if (!confirm("Reset Draft?\n\nThis will erase the current draft progress and draft results for this league and return the league to the pre-draft state.")) return;
            if (!confirm("Are you sure? This can't be undone from here.")) return;
            act({ type: "resetDraft", confirm: "RESET", requestId: crypto.randomUUID() }, "Draft reset. The league is back to pre-draft.");
          }}>Reset Draft</Button>
        </Panel>
      )}
      {team(league.commissionerId) && <p className="mt-4 text-xs text-muted-foreground">Global scoring, rules, meets and player info are managed by the Main League commissioner.</p>}
    </div>
  );
}
