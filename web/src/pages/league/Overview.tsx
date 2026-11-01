import { Link } from "react-router-dom";
import { Crown, Radio, Trophy } from "lucide-react";

import { LiveDot, Panel, TeamAvatar } from "@/components/td";
import { useLeague } from "@/lib/league";
import { fmtPts, record, timeAgo, weekLabel } from "@/lib/types";

export default function Overview() {
  const { league, team, myTeam } = useLeague();
  const week = league.phase === "season" ? league.week : Math.max(1, league.lastCompletedWeek);
  const my = league.schedule.find((m) => m.week === week && (m.homeId === league.me || m.awayId === league.me));
  const oppId = my ? (my.homeId === league.me ? my.awayId : my.homeId) : null;
  const myScore = my ? (my.homeId === league.me ? my.homeScore : my.awayScore ?? 0) : 0;
  const oppScore = my ? (my.homeId === league.me ? my.awayScore ?? 0 : my.homeScore) : 0;
  const liveMeets = league.meets.filter((m) => m.status === "LIVE" && !m.archived);
  const champ = league.bracket?.championId ? team(league.bracket.championId) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        {league.isMainLeague && (
          <div className="flex items-center gap-3 rounded-2xl border border-td-gold/30 bg-td-gold/[0.06] p-4">
            <Crown className="h-6 w-6 text-td-gold" />
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-td-gold">Main League • {league.mainLeagueCode}</p>
              <p className="text-sm text-foreground/85">This league's scoring, rules and meets apply to every league in the game.</p>
            </div>
          </div>
        )}
        {champ && (
          <div className="panel flex items-center gap-4 p-5">
            <Trophy className="h-10 w-10 text-td-gold" />
            <div><p className="text-[11px] font-black uppercase tracking-[0.12em] text-td-gold">{league.season} Champion</p><p className="font-display text-3xl">{champ.teamName}</p></div>
          </div>
        )}
        {my && oppId !== undefined ? (
          <Link to={`/league/${league.id}/matchup`} className="panel lane-lines block overflow-hidden p-6 transition hover:border-td-green/40">
            <div className="flex items-center justify-between">
              <p className="eyebrow">{weekLabel(league, week)} matchup</p>
              {liveMeets.length > 0 && <span className="flex items-center gap-1.5 text-xs font-black text-td-red"><LiveDot /> LIVE</span>}
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <div className="flex items-center gap-3">
                <TeamAvatar team={myTeam} leagueId={league.id} size={52} />
                <div className="min-w-0"><p className="truncate font-semibold">{myTeam?.teamName}</p><p className="text-xs text-muted-foreground">{myTeam ? record(myTeam) : ""}</p></div>
              </div>
              <div className="num flex items-baseline gap-3 text-5xl">
                <span className={myScore >= oppScore ? "text-td-green" : ""}>{fmtPts(myScore)}</span>
                <span className="text-xl text-td-faint">vs</span>
                <span className={oppScore > myScore ? "text-td-green" : ""}>{fmtPts(oppScore)}</span>
              </div>
              <div className="flex items-center justify-end gap-3 text-right">
                <div className="min-w-0"><p className="truncate font-semibold">{oppId ? team(oppId)?.teamName : "Bye"}</p><p className="text-xs text-muted-foreground">{oppId && team(oppId) ? record(team(oppId)!) : ""}</p></div>
                <TeamAvatar team={team(oppId)} leagueId={league.id} size={52} />
              </div>
            </div>
          </Link>
        ) : (
          <Panel title={league.phase === "predraft" ? "Draft" : "Season"}>
            <p className="font-display text-3xl">{league.phase === "predraft" ? (league.settings.draftAt ? `Draft ${new Date(league.settings.draftAt).toLocaleString()}` : "Draft not scheduled") : league.phase === "drafting" ? "The draft is live" : "Season complete"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{league.teams.length} of {league.settings.maxTeams} teams. Invite friends with code <span className="num text-foreground">{league.code}</span>.</p>
            {league.phase !== "complete" && <Link to={`/league/${league.id}/draft`} className="mt-4 inline-block rounded-full bg-td-green px-5 py-2 text-sm font-bold text-black">Open draft room</Link>}
          </Panel>
        )}
        {liveMeets.length > 0 && (
          <Panel title="Live meets">
            {liveMeets.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-1.5"><Radio className="h-4 w-4 text-td-red" /><span className="font-semibold">{m.name}</span><span className="text-xs text-muted-foreground">{m.stats.processed} results • updated {m.lastSyncedAt ? timeAgo(m.lastSyncedAt) : "never"}</span></div>
            ))}
          </Panel>
        )}
        <Panel title="Recent activity" pad={false}>
          <ul className="divide-y divide-border">
            {[...league.transactions].reverse().slice(0, 12).map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"><span>{t.text}</span><span className="shrink-0 text-xs text-td-faint">{timeAgo(t.at)}</span></li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Standings" pad={false} right={<Link to={`/league/${league.id}/standings`} className="text-xs font-bold text-td-green">Full</Link>}>
        <ol className="divide-y divide-border">
          {league.standings.map((id, i) => {
            const t = team(id);
            if (!t) return null;
            return (
              <li key={id} className={`flex items-center gap-3 px-4 py-2.5 ${id === league.me ? "bg-td-green/[0.06]" : ""}`}>
                <span className="num w-5 text-lg text-td-faint">{i + 1}</span>
                <TeamAvatar team={t} leagueId={league.id} size={30} />
                <Link to={`/league/${league.id}/team/${t.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{t.teamName}</Link>
                <span className="num text-lg">{record(t)}</span>
                <span className="num w-16 text-right text-sm text-muted-foreground">{fmtPts(t.pointsFor)}</span>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
