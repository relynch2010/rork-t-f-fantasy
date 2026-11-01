import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Crown, EyeOff, Eye, Plus, Trophy, Users } from "lucide-react";
import { toast } from "sonner";

import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, PageHeader } from "@/components/td";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { LeagueState, LeagueSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Home() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState<boolean>(false);
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const q = useQuery({ queryKey: ["leagues"], queryFn: () => api<{ leagues: LeagueSummary[] }>("/leagues") });
  const leagues = q.data?.leagues ?? [];
  const visible = useMemo(() => leagues.filter((l) => !l.hidden), [leagues]);

  const hide = useMutation({
    mutationFn: (v: { id: string; hidden: boolean }) => api(`/leagues/${v.id}/hide`, { body: { hidden: v.hidden } }),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["leagues"] }); toast.success(v.hidden ? "Hidden from Home" : "Back on Home"); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <PageHeader
          eyebrow={`Welcome, ${user?.name ?? "Coach"}`}
          title="My Leagues"
          right={<>
            <Button variant="secondary" className="rounded-full" onClick={() => setDialog("join")}><Users /> Join league</Button>
            <Button className="rounded-full font-bold" onClick={() => setDialog("create")}><Plus /> Create league</Button>
          </>}
        />
        {q.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="panel h-36 animate-pulse" />)}</div>
        ) : visible.length === 0 ? (
          <Empty icon={<Trophy className="h-9 w-9" />} title="No leagues on Home">Create a league or join one with its 6-character invite code.</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((l) => <LeagueCard key={l.leagueId} l={l} onHide={() => hide.mutate({ id: l.leagueId, hidden: true })} />)}
          </div>
        )}

        {leagues.length > 0 && (
          <div className="mt-10">
            <button className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)}>
              {showAll ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} All Leagues ({leagues.length})
            </button>
            {showAll && (
              <div className="panel mt-3 divide-y divide-border">
                {leagues.map((l) => (
                  <div key={l.leagueId} className="flex items-center gap-3 px-4 py-3">
                    <Link to={`/league/${l.leagueId}`} className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate font-semibold">{l.isMainLeague && <Crown className="h-4 w-4 text-td-gold" />}{l.name}</p>
                      <p className="text-xs text-muted-foreground">Code {l.code}{l.hidden ? " • Hidden from Home" : ""}</p>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => hide.mutate({ id: l.leagueId, hidden: !l.hidden })}>
                      {l.hidden ? <><Eye /> Show on Home</> : <><EyeOff /> Hide</>}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      <CreateDialog open={dialog === "create"} onClose={() => setDialog(null)} onDone={(id) => { qc.invalidateQueries({ queryKey: ["leagues"] }); navigate(`/league/${id}`); }} />
      <JoinDialog open={dialog === "join"} onClose={() => setDialog(null)} onDone={(id) => { qc.invalidateQueries({ queryKey: ["leagues"] }); navigate(`/league/${id}`); }} />
    </div>
  );
}

function LeagueCard({ l, onHide }: { l: LeagueSummary; onHide: () => void }) {
  return (
    <div className={cn("panel group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-td-green/40", l.isMainLeague && "border-td-gold/30")}>
      <div className="lane-lines pointer-events-none absolute inset-0 opacity-60" />
      <Link to={`/league/${l.leagueId}`} className="relative block">
        {l.isMainLeague ? (
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-td-gold"><Crown className="h-3.5 w-3.5" /> Main League</p>
        ) : (
          <p className="eyebrow">League</p>
        )}
        <p className="font-display mt-1 truncate text-3xl">{l.name}</p>
        <p className="mt-6 text-sm text-muted-foreground">Invite code <span className="num text-base tracking-widest text-foreground">{l.code}</span></p>
      </Link>
      <button onClick={onHide} className="absolute right-3 top-3 rounded-full p-2 text-td-faint opacity-0 transition hover:bg-td-surface2 hover:text-foreground group-hover:opacity-100" title="Hide from Home">
        <EyeOff className="h-4 w-4" />
      </button>
    </div>
  );
}

function CreateDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("");
  const [maxTeams, setMaxTeams] = useState<number>(12);
  const [school, setSchool] = useState<string>("Cornwall Central");
  const schools = useQuery({ queryKey: ["schools"], queryFn: () => api<{ schools: { name: string; athletes: number }[] }>("/schools"), enabled: open });
  const clean = school.trim();
  const cornwall = !clean || clean.toLowerCase().startsWith("cornwall central");
  const known = (schools.data?.schools ?? []).some((x) => x.name.toLowerCase() === clean.toLowerCase());
  const m = useMutation({
    mutationFn: () => api<LeagueState>("/leagues", { body: { name, teamName, school: cornwall ? "" : clean, settings: { maxTeams } } }),
    onSuccess: (s) => { toast.success("League created"); onClose(); onDone(s.id); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-3xl">New League</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>League name</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>
          <div className="space-y-1.5"><Label>Your team name</Label><Input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={28} /></div>
          <div className="space-y-1.5">
            <Label>School</Label>
            <Input value={school} onChange={(e) => setSchool(e.target.value)} maxLength={60} list="td-schools" />
            <datalist id="td-schools">{(schools.data?.schools ?? []).map((x) => <option key={x.name} value={x.name} />)}</datalist>
            <p className="text-xs text-muted-foreground">
              {cornwall ? "Cornwall Central leagues use the shared Cornwall Central player list and the Main League's meets."
                : known ? `${clean} already has players on file. Your league shares them, and you schedule your own meets.`
                : "New school: your league starts with an empty player list. Import your roster in the iPhone app (Commissioner Tools → Athlete Editor) and schedule your own meets."}
            </p>
          </div>
          <div className="space-y-1.5"><Label>Max teams ({maxTeams})</Label><input type="range" min={2} max={14} value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))} className="w-full accent-[hsl(var(--td-green))]" /></div>
          <p className="rounded-xl bg-td-surface2 p-3 text-xs text-muted-foreground">Scoring, roster spots, season length, playoffs, waivers and trades are the same in every league. Set the draft time and order in League Settings.</p>
        </div>
        <DialogFooter><Button className="rounded-full font-bold" disabled={m.isPending} onClick={() => m.mutate()}>Create league</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [code, setCode] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("");
  const isCo = code.replace(/[^A-Za-z0-9]/g, "").length === 7;
  const m = useMutation({
    mutationFn: async () => {
      const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (clean.length === 7) {
        const r = await api<{ leagueId: string }>("/leagues/co/accept", { body: { code: clean } });
        return r.leagueId;
      }
      const s = await api<LeagueState>("/leagues/join", { body: { code: clean, teamName } });
      return s.id;
    },
    onSuccess: (id) => { toast.success("You're in"); onClose(); onDone(id); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-3xl">Join a League</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Invite code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} className="num text-2xl tracking-[0.3em]" placeholder="ABC123" />
            <p className="text-xs text-muted-foreground">6 characters to join with your own team. 7 characters to co-manage someone's team.</p>
          </div>
          {!isCo && <div className="space-y-1.5"><Label>Your team name</Label><Input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={28} /></div>}
        </div>
        <DialogFooter><Button className="rounded-full font-bold" disabled={m.isPending || code.length < 6} onClick={() => m.mutate()}>{isCo ? "Accept co-manager invite" : "Join league"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
