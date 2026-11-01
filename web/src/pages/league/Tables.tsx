import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Panel, TeamAvatar } from "@/components/td";
import { useLeague } from "@/lib/league";
import { fmtPts, record, weekLabel } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Scoreboard() {
  const { league, team } = useLeague();
  const [week, setWeek] = useState<number>(league.phase === "season" ? league.week : Math.max(1, league.lastCompletedWeek));
  const games = league.schedule.filter((m) => m.week === week);
  return (
    <div>
      <PageHeader title="Scoreboard" right={<>
        <Button variant="ghost" size="icon" disabled={week <= 1} onClick={() => setWeek(week - 1)}><ChevronLeft /></Button>
        <span className="font-display w-40 text-center text-xl">{weekLabel(league, week)}</span>
        <Button variant="ghost" size="icon" disabled={week >= league.totalWeeks} onClick={() => setWeek(week + 1)}><ChevronRight /></Button>
      </>} />
      {games.length === 0 ? <Empty title="No matchups yet">The schedule is created when the draft finishes.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {games.map((m) => {
            const side = (tid: string | null, s: number | null, win: boolean) => {
              const t = team(tid);
              return (
                <div className="flex items-center gap-3 py-2">
                  <TeamAvatar team={t} leagueId={league.id} size={36} />
                  <div className="min-w-0 flex-1"><p className="truncate font-semibold">{t?.teamName ?? "Bye"}</p><p className="text-xs text-muted-foreground">{t ? record(t) : ""}</p></div>
                  <span className={cn("num text-3xl", win && "text-td-green")}>{tid ? fmtPts(s) : ""}</span>
                </div>
              );
            };
            const hw = (m.homeScore ?? 0) >= (m.awayScore ?? 0);
            return (
              <Link key={m.id} to={`/league/${league.id}/matchup?week=${week}&team=${m.homeId}`} className="panel block p-4 transition hover:border-td-green/40">
                <div className="flex justify-between"><span className="eyebrow">{m.kind === "regular" ? "Regular season" : m.round ?? m.kind}</span>{m.final && <span className="text-[11px] font-black text-td-faint">FINAL</span>}</div>
                {side(m.homeId, m.homeScore, hw && !!m.awayId)}
                <div className="h-px bg-border" />
                {side(m.awayId, m.awayScore, !hw)}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Standings() {
  const { league, team } = useLeague();
  const playoffLine = league.settings.playoffTeams;
  return (
    <div>
      <PageHeader title="Standings" sub={`Tiebreaker: ${league.settings.tiebreaker === "h2h" ? "head-to-head" : "points for"}${playoffLine ? ` • Top ${playoffLine} make the playoffs` : ""}`} />
      <Panel pad={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-black uppercase tracking-[0.1em] text-td-faint">
              <th className="px-4 py-2">#</th><th className="py-2">Team</th><th className="py-2 text-right">W-L-T</th><th className="py-2 text-right">PF</th><th className="py-2 text-right">PA</th><th className="px-4 py-2 text-right">Streak</th>
            </tr>
          </thead>
          <tbody>
            {league.standings.map((id, i) => {
              const t = team(id);
              if (!t) return null;
              return (
                <tr key={id} className={cn("border-b border-border last:border-0", id === league.me && "bg-td-green/[0.06]", playoffLine > 0 && i === playoffLine - 1 && "border-b-2 border-b-td-green/50")}>
                  <td className="num px-4 py-3 text-lg text-td-faint">{i + 1}</td>
                  <td className="py-3"><Link to={`/league/${league.id}/team/${t.id}`} className="flex items-center gap-3 hover:underline"><TeamAvatar team={t} leagueId={league.id} size={32} /><span className="font-semibold">{t.teamName}</span><span className="hidden text-xs text-muted-foreground md:inline">{t.ownerName}</span></Link></td>
                  <td className="num py-3 text-right text-lg">{record(t)}</td>
                  <td className="num py-3 text-right text-lg">{fmtPts(t.pointsFor)}</td>
                  <td className="num py-3 text-right text-lg text-muted-foreground">{fmtPts(t.pointsAgainst)}</td>
                  <td className="px-4 py-3 text-right font-bold">{t.streak || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

export function Playoffs() {
  const { league, team } = useLeague();
  const b = league.bracket;
  if (!b) return <div><PageHeader title="Playoffs" /><Empty icon={<Trophy className="h-9 w-9" />} title="No bracket yet">{league.settings.playoffTeams === 0 ? "This game has no playoffs: best record wins." : "The bracket is created when the draft finishes and seeded after the regular season."}</Empty></div>;
  const champ = team(b.championId);
  return (
    <div>
      <PageHeader title="Playoffs" sub={`${b.teams} teams • ${b.seeded ? "Seeded" : "Seeds set after the regular season"}`} />
      {champ && <div className="panel mb-5 flex items-center gap-4 p-5"><Trophy className="h-10 w-10 text-td-gold" /><div><p className="text-[11px] font-black uppercase tracking-[0.12em] text-td-gold">Champion</p><p className="font-display text-3xl">{champ.teamName}</p></div></div>}
      <div className="flex gap-6 overflow-x-auto pb-4">
        {b.rounds.map((r) => (
          <div key={r.name} className="min-w-[260px] flex-1">
            <p className="eyebrow mb-3">{r.name} • Week {r.week}</p>
            <div className="flex flex-col justify-around gap-4">
              {r.games.map((g) => (
                <div key={g.id} className="panel p-3">
                  {[[g.top, g.topSeed], [g.bottom, g.bottomSeed]].map(([tid, seed], i) => {
                    const t = team(tid as string | null);
                    return (
                      <div key={i} className={cn("flex items-center gap-2 py-1.5", g.winnerId && g.winnerId === tid && "text-td-green")}>
                        <span className="num w-5 text-td-faint">{seed ?? ""}</span>
                        <TeamAvatar team={t} leagueId={league.id} size={26} />
                        <span className="truncate font-semibold">{t?.teamName ?? (b.seeded ? "Bye" : "TBD")}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
