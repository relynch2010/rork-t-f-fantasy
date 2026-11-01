import { NavLink, Outlet, useParams } from "react-router-dom";
import { Bell, Crown, Wifi, WifiOff } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { SplashScreen } from "@/components/td";
import { LeagueProvider, useLeague } from "@/lib/league";
import { cn } from "@/lib/utils";

export default function LeagueLayout() {
  const { id = "" } = useParams();
  return (
    <LeagueProvider id={id} fallback={<SplashScreen label="Loading league" />}>
      <Shell />
    </LeagueProvider>
  );
}

function Shell() {
  const { league, live, isCommish } = useLeague();
  const unread = league.notifications.filter((n) => !n.read).length;
  const base = `/league/${league.id}`;
  const tabs: [string, string][] = [
    ["", "League"], ["team", "My Team"], ["matchup", "Matchup"], ["scoreboard", "Scoreboard"], ["standings", "Standings"],
    ["players", "Players"], ["draft", "Draft"], ["mocks", "Mock Drafts"], ["waivers", "Waivers"], ["activity", "Activity"], ["playoffs", "Playoffs"],
    ["meets", "Meets"], ["global", league.canEditGlobal ? "Global Settings" : "Game Rules"], ["settings", "Settings"],
    ...(isCommish ? ([["integrity", "Integrity"], ["commish", "Commish"]] as [string, string][]) : []),
    ...(isCommish && league.canEditGlobal ? ([["admin", "Admin"]] as [string, string][]) : []),
  ];
  return (
    <div className="min-h-screen">
      <TopBar>
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-display text-xl leading-none">
              {league.isMainLeague && <Crown className="h-4 w-4 shrink-0 text-td-gold" />}{league.name}
            </p>
            <p className="text-[11px] text-muted-foreground">Code {league.code} • {league.phase === "season" ? `Week ${league.week}` : league.phase === "predraft" ? "Pre-draft" : league.phase === "drafting" ? "Drafting" : "Season complete"}</p>
          </div>
          <span className={cn("ml-auto hidden items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase md:inline-flex", live ? "bg-td-green/15 text-td-green" : "bg-td-surface2 text-td-faint")} title={live ? "Live updates on" : "Reconnecting"}>
            {live ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />} {live ? "Live" : "Offline"}
          </span>
          <NavLink to={`${base}/alerts`} className="relative grid h-9 w-9 place-items-center rounded-full hover:bg-td-surface2" title="Notifications">
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-td-red px-1 text-[10px] font-black text-white">{unread > 9 ? "9+" : unread}</span>}
          </NavLink>
        </div>
      </TopBar>
      <nav className="sticky top-16 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
          {tabs.map(([path, label]) => (
            <NavLink
              key={path}
              to={path ? `${base}/${path}` : base}
              end={!path}
              className={({ isActive }) => cn("relative shrink-0 px-3 py-3 text-sm font-semibold text-muted-foreground transition hover:text-foreground", isActive && "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-full after:bg-td-green")}
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
