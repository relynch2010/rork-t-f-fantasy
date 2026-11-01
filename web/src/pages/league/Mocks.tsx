import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Cpu, Shuffle, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AthleteAvatar, Empty, PageHeader, Panel, PosTag } from "@/components/td";
import { api } from "@/lib/api";
import { useLeague } from "@/lib/league";
import type { MockBody, MockDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import { clock, useCountdown } from "./Draft";

/** Draft slot chips: Random, 1…N. Taken slots are disabled. */
function PositionPicker({ value, teams, taken, onChange }: { value: number; teams: number; taken?: Set<number>; onChange: (n: number) => void }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm"><span className="font-semibold">Your draft position</span><span className="font-bold text-td-green">{value === 0 ? "Random" : `Pick #${value}`}</span></div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => onChange(0)} className={cn("flex h-9 items-center gap-1 rounded-full px-3 text-sm font-bold", value === 0 ? "bg-td-green text-black" : "bg-td-surface2 hover:bg-td-raised")}><Shuffle className="h-3.5 w-3.5" /> Random</button>
        {Array.from({ length: teams }, (_, i) => i + 1).map((n) => {
          const isTaken = !!taken?.has(n) && value !== n;
          return (
            <button key={n} disabled={isTaken} onClick={() => onChange(n)} title={isTaken ? "Taken" : `Pick #${n}`}
              className={cn("num h-9 min-w-9 rounded-full px-2 text-base", value === n ? "bg-td-green text-black" : "bg-td-surface2 hover:bg-td-raised", isTaken && "cursor-not-allowed opacity-30")}>{n}</button>
          );
        })}
      </div>
    </div>
  );
}

export default function Mocks() {
  const { league, mockSignal } = useLeague();
  const [data, setData] = useState<MockBody | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [teams, setTeams] = useState<number>(Math.max(4, Math.min(14, league.teams.length || 8)));
  const [position, setPosition] = useState<number>(0);

  const load = useCallback(async (mockId = "") => {
    try { setData(await api<MockBody>(`/leagues/${league.id}/mock?mockId=${mockId}`)); } catch (e) { toast.error((e as Error).message); }
  }, [league.id]);
  const op = useCallback(async (body: Record<string, unknown>): Promise<MockBody | null> => {
    try { const r = await api<MockBody>(`/leagues/${league.id}/mock`, { body }); setData(r); return r; } catch (e) { toast.error((e as Error).message); return null; }
  }, [league.id]);

  useEffect(() => { load(open ?? ""); }, [load, open, mockSignal]);
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => load(open), 3000);
    return () => window.clearInterval(t);
  }, [open, load]);

  const mock = open ? data?.mock ?? null : null;
  if (open && mock) return <MockRoom mock={mock} serverNow={data?.serverNow ?? Date.now()} op={op} onBack={() => setOpen(null)} />;

  return (
    <div>
      <PageHeader title="Mock Drafts" sub="Practice only. Never touches real rosters, the real draft, standings or history." />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Panel title="New mock">
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-sm"><span className="font-semibold">Teams</span><span className="num text-lg">{teams}</span></div>
              <input type="range" min={2} max={14} value={teams} onChange={(e) => { const n = Number(e.target.value); setTeams(n); if (position > n) setPosition(n); }} className="w-full accent-[hsl(var(--td-green))]" />
            </div>
            <PositionPicker value={position} teams={teams} onChange={setPosition} />
            <div className="grid grid-cols-2 gap-2">
              <Button className="font-bold" onClick={async () => { const r = await op({ op: "create", kind: "solo", teams, position }); if (r?.mock) setOpen(r.mock.id); }}><Cpu /> Solo vs bots</Button>
              <Button variant="secondary" onClick={async () => { const r = await op({ op: "create", kind: "league", teams, position }); if (r?.mock) setOpen(r.mock.id); }}><Users /> League mock</Button>
            </div>
          </div>
        </Panel>
        <div className="space-y-3">
          {(data?.mocks ?? []).length === 0 ? <Empty icon={<Bot className="h-9 w-9" />} title="No mock drafts yet">Practice the six-round snake draft.</Empty> : data!.mocks.map((m) => (
            <button key={m.id} onClick={() => setOpen(m.id)} className="panel flex w-full items-center gap-4 p-4 text-left hover:border-td-green/40">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-td-flex text-black">{m.kind === "solo" ? <Cpu /> : <Users />}</div>
              <div className="flex-1"><p className="font-semibold">{m.kind === "solo" ? "Solo mock" : `${m.ownerName}'s league mock`}</p><p className="text-xs text-muted-foreground">{m.seats} teams • {m.joined} people • {m.picks} picks • {m.status.toUpperCase()}</p></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MockRoom({ mock, serverNow, op, onBack }: { mock: MockDraft; serverNow: number; op: (b: Record<string, unknown>) => Promise<MockBody | null>; onBack: () => void }) {
  const { league, athlete } = useLeague();
  const offset = useMemo(() => serverNow - Date.now(), [serverNow]);
  const now = useCallback(() => Date.now() + offset, [offset]);
  const left = useCountdown(mock.status === "live" ? mock.deadline : null, now);
  const taken = new Set(mock.picks.map((p) => p.athleteId));
  const mine = !!mock.onClock && mock.onClock === mock.mySeat;
  const me = mock.seats.find((s) => s.id === mock.mySeat);
  const isOwner = mock.ownerId === league.viewerId;
  const avail = (league.adp.length ? league.adp : league.rankings).map((id) => athlete(id)).filter((a): a is NonNullable<typeof a> => !!a && !taken.has(a.id)).slice(0, 120);
  const canPickPos = !!me && (mock.status === "lobby" || (mock.kind === "solo" && !mock.picks.some((p) => p.seatId === me.id) && mock.picks.length < mock.order.length));
  const myIdx = me ? mock.order.indexOf(me.id) : -1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>← All mocks</Button>
        <div className="flex gap-2">
          {mock.status === "lobby" && !mock.mySeat && <Button onClick={() => op({ op: "join", mockId: mock.id })}>Join</Button>}
          {mock.status === "lobby" && isOwner && <Button className="font-bold" onClick={() => op({ op: "start", mockId: mock.id })}>Start now</Button>}
          {isOwner && <Button variant="secondary" onClick={() => op({ op: "reset", mockId: mock.id })}>Restart</Button>}
          {isOwner && <Button variant="ghost" onClick={async () => { if (confirm("Delete this mock?") && (await op({ op: "delete", mockId: mock.id }))) onBack(); }}><Trash2 /></Button>}
        </div>
      </div>
      <div className={cn("panel p-5", mine && "border-td-green/60")}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">{mock.status === "lobby" ? "Waiting to start" : mock.status === "done" ? "Mock complete" : `Pick ${mock.picks.length + 1} of ${mock.order.length * mock.rounds}`}{myIdx >= 0 && mock.status !== "lobby" ? ` • You pick #${myIdx + 1}` : ""}</p>
            <p className={cn("font-display text-4xl", mine && "text-td-green")}>{mock.status === "lobby" ? `${mock.seats.filter((s) => !s.bot).length} of ${mock.seats.length} seats taken` : mock.status === "done" ? "Nice draft" : mine ? "You're on the clock" : `${mock.seats.find((s) => s.id === mock.onClock)?.name ?? ""} is picking`}</p>
          </div>
          {mock.status === "live" && <span className={cn("num text-5xl", left <= 10 && "text-td-red")}>{clock(left)}</span>}
        </div>
        {canPickPos && me && (
          <div className="mt-5 max-w-xl">
            <PositionPicker value={me.slot ?? 0} teams={mock.seats.length} taken={new Set(mock.seats.filter((s) => !s.bot && s.id !== me.id).map((s) => s.slot ?? 0).filter(Boolean))} onChange={(n) => op({ op: "setPosition", mockId: mock.id, position: n })} />
          </div>
        )}
      </div>
      {mock.status !== "lobby" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <Panel title="Board" pad={false}>
            <div className="max-h-[560px] divide-y divide-border overflow-y-auto">
              {[...mock.picks].reverse().map((p) => (
                <div key={p.overall} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="num w-10 text-td-faint">{p.round}.{p.pickInRound}</span>
                  <span className="flex-1 font-semibold">{athlete(p.athleteId)?.name}</span>
                  <span className={p.seatId === mock.mySeat ? "text-td-green" : "text-muted-foreground"}>{mock.seats.find((s) => s.id === p.seatId)?.name}{p.auto ? " • auto" : ""}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Available" pad={false}>
            <div className="max-h-[560px] overflow-y-auto">
              {avail.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b border-border px-3 py-2">
                  <AthleteAvatar athlete={a} size={30} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{a.name}</p><PosTag position={a.position} /></div>
                  {mine && <Button size="sm" className="font-bold" onClick={() => op({ op: "pick", mockId: mock.id, athleteId: a.id, pickNumber: mock.picks.length + 1 })}>Draft</Button>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
