import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Globe2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MainLeagueBanner, PageHeader, Panel } from "@/components/td";
import { api } from "@/lib/api";
import { useLeague } from "@/lib/league";
import { waiverScheduleLabel } from "@/lib/types";
import { useAuth } from "@/lib/auth";

/**
 * Account password. The server keeps only a one-way hash, so it can't be shown on the web; it's always masked here.
 * Changing it needs the current password and signs out every other session.
 */
function PasswordPanel() {
  const { refreshSession } = useAuth();
  const [open, setOpen] = useState<boolean>(false);
  const [current, setCurrent] = useState<string>("");
  const [next, setNext] = useState<string>("");
  const [confirmPw, setConfirmPw] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const problem = next && next.length < 8 ? "Use at least 8 characters." : confirmPw && confirmPw !== next ? "Passwords don't match." : null;
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const r = await api<{ token: string; user: { id: string; name: string; email?: string } }>("/me/password", { body: { current, password: next } });
      refreshSession(r.token, r.user);
      toast.success("Password changed. Other devices were signed out.");
      setOpen(false); setCurrent(""); setNext(""); setConfirmPw("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel title="Password">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-lg tracking-widest text-muted-foreground">••••••••••</span>
        <Button variant="secondary" onClick={() => setOpen((v) => !v)}>{open ? "Cancel" : "Change Password"}</Button>
      </div>
      {open && (
        <div className="mt-4 space-y-3">
          <Input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} />
          <Input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          {problem && <p className="text-xs text-td-red">{problem}</p>}
          <Button className="font-bold" disabled={saving || !current || next.length < 8 || next !== confirmPw} onClick={save}>Save new password</Button>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Only you can see this. For security your password is stored scrambled, so the website can't show it. On iPhone you can reveal it with Face ID.</p>
    </Panel>
  );
}

export default function SettingsPage() {
  const { league, act, busy, isCommish, myTeam } = useLeague();
  const navigate = useNavigate();
  const s = league.settings;
  const pre = league.phase === "predraft";
  const [name, setName] = useState<string>(league.name);
  const [teamName, setTeamName] = useState<string>(myTeam?.teamName ?? "");
  const [maxTeams, setMaxTeams] = useState<number>(s.maxTeams);
  const [draftAt, setDraftAt] = useState<string>(s.draftAt ? new Date(s.draftAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const [orderMode, setOrderMode] = useState<string>(s.draftOrderMode);
  const [confirmName, setConfirmName] = useState<string>("");
  const isPrimary = myTeam?.id === league.viewerId;

  const saveLeague = (): void => {
    const body: Record<string, unknown> = { type: "updateSettings", name, maxTeams, draftOrderMode: orderMode };
    if (pre) body.draftAt = draftAt ? new Date(draftAt).getTime() : 0;
    act(body, "League settings saved");
  };

  const rows: [string, string][] = [
    ["Pick timer", s.pickSeconds >= 60 ? `${s.pickSeconds / 60} min` : `${s.pickSeconds} sec`],
    ["Regular season", `${s.regularWeeks} weeks`],
    ["Playoff teams", s.playoffTeams === 0 ? "No playoffs" : `${s.playoffTeams} teams${s.consolation ? " + consolation" : ""}`],
    ["Tiebreaker", s.tiebreaker === "h2h" ? "Head-to-head" : "Points for"],
    ["Waivers", s.waiverType === "faab" ? `Budget bidding ($${s.faabBudget})` : "Rolling priority"],
    ["Waivers process", waiverScheduleLabel(s)],
    ["Dropped players", s.waiverSchedule === "daily" ? `${s.waiverDays} days on waivers` : "On waivers until the next run"],
    ["Weekly add limit", s.maxAddsPerWeek === 0 ? "None" : String(s.maxAddsPerWeek)],
    ["Trade review", s.tradeReview === "commish" ? "Commissioner" : s.tradeReview === "league" ? `League vote (${s.vetoVotes} vetoes)` : "None"],
    ["Trade deadline", s.tradeDeadlineWeek === 0 ? "None" : `Week ${s.tradeDeadlineWeek}`],
    ["Lineup lock", s.lineupLock === "manual" ? "Commissioner locks" : "When each event starts"],
  ];

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <PasswordPanel />
          <Panel title="My team">
            <div className="flex gap-2">
              <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={28} />
              <Button disabled={busy} onClick={() => act({ type: "renameTeam", teamName }, "Team renamed")}>Save</Button>
            </div>
            <div className="mt-5">
              <p className="eyebrow mb-2">Co-manager</p>
              {myTeam?.coManagerName ? (
                <div className="flex items-center justify-between text-sm">
                  <span><b>{myTeam.coManagerName}</b> co-manages this team.</span>
                  {isPrimary ? <Button size="sm" variant="secondary" onClick={() => confirm("Remove your co-manager?") && act({ type: "removeCoManager" }, "Co-manager removed")}>Remove</Button>
                    : <Button size="sm" variant="secondary" onClick={() => confirm("Stop co-managing this team?") && act({ type: "leaveCoManager" }).then((ok) => ok && navigate("/"))}>Leave</Button>}
                </div>
              ) : isPrimary && myTeam?.coInvite ? (
                <div className="flex items-center gap-3">
                  <span className="num rounded-lg bg-td-surface2 px-3 py-1 text-2xl tracking-[0.3em]">{myTeam.coInvite.code}</span>
                  <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(myTeam.coInvite!.code); toast.success("Copied"); }}><Copy /></Button>
                  <Button size="sm" variant="ghost" onClick={() => act({ type: "cancelCoInvite" }, "Invite cancelled")}>Cancel invite</Button>
                </div>
              ) : isPrimary ? (
                <Button variant="secondary" onClick={() => act({ type: "createCoInvite" }, "Invite code created")}>Invite a co-manager</Button>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">A co-manager can set lineups, add/drop, trade and draft for your team. They don't get their own team.</p>
            </div>
          </Panel>
          {isCommish && (
            <Panel title="League (commissioner)">
              <div className="space-y-4">
                <div className="space-y-1.5"><Label>League name</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>
                <div className="space-y-1.5"><Label>Max teams ({maxTeams})</Label><input type="range" min={Math.max(2, league.teams.length)} max={14} value={maxTeams} disabled={!pre} onChange={(e) => setMaxTeams(Number(e.target.value))} className="w-full accent-[hsl(var(--td-green))]" /></div>
                <div className="space-y-1.5"><Label>Draft time</Label><Input type="datetime-local" value={draftAt} disabled={!pre} onChange={(e) => setDraftAt(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label>Draft order</Label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={orderMode} disabled={!pre} onChange={(e) => setOrderMode(e.target.value)}>
                    <option value="random">Random</option><option value="manual">Set manually</option>
                  </select>
                </div>
                <Button className="font-bold" disabled={busy} onClick={saveLeague}>Save league settings</Button>
                {!pre && <p className="text-xs text-muted-foreground">League size and draft settings lock once the draft starts.</p>}
              </div>
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <MainLeagueBanner>{league.canEditGlobal ? "You're the Main League commissioner. Change these for every league in Global Settings." : "Scoring, roster rules, season length, playoffs, waivers, trades and lineup rules are the same in every league."}</MainLeagueBanner>
          <Panel title="Game rules" pad={false} right={<Button size="sm" variant="ghost" onClick={() => navigate(`/league/${league.id}/global`)}><Globe2 /> {league.canEditGlobal ? "Edit" : "Details"}</Button>}>
            {rows.map(([k, v]) => <div key={k} className="flex justify-between border-b border-border px-4 py-2.5 text-sm last:border-0"><span className="text-muted-foreground">{k}</span><span className="font-semibold">{v}</span></div>)}
            {league.shapePending && <p className="px-4 pb-3 text-xs text-td-gold">New season length and playoff settings apply at this league's next draft.</p>}
          </Panel>
          {isCommish && !league.isMainLeague && (
            <Panel title="Danger zone" className="border-td-red/30">
              <p className="text-sm text-muted-foreground">Permanently deletes the league, its teams, rosters, draft, matchups, activity, meets data and mock drafts for everyone. Accounts and other leagues are kept.</p>
              <div className="mt-3 flex gap-2">
                <Input placeholder={`Type "${league.name}" to confirm`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                <Button variant="destructive" disabled={confirmName.trim() !== league.name.trim()} onClick={async () => {
                  try { await api(`/leagues/${league.id}/delete`, { body: { confirmName } }); toast.success("League deleted"); navigate("/"); } catch (e) { toast.error((e as Error).message); }
                }}>Delete league</Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
