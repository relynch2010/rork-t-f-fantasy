import { useState } from "react";
import { ArrowLeftRight, Bell, CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Empty, PageHeader, Panel } from "@/components/td";
import { useLeague } from "@/lib/league";
import { timeAgo } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Activity() {
  const { league, team, athlete, act, busy, isCommish } = useLeague();
  const [tradeOpen, setTradeOpen] = useState<boolean>(false);
  const [scope, setScope] = useState<"mine" | "league">("mine");
  type Row = { id: string; text: string; at: number; status: string };
  const txRows: Row[] = [
    ...league.transactions.filter((t) => scope === "league" || (t.mine ?? t.teamId === league.me)).map((t) => ({ id: t.id, text: t.text, at: t.at, status: t.status ?? "completed" })),
    ...(scope === "mine" ? [
      ...league.claims.filter((c) => c.status === "lost" || c.status === "cancelled").map((c) => ({ id: `c-${c.id}`, text: `Claim for ${athlete(c.addId)?.name ?? "?"}${c.reason ? ` · ${c.reason}` : ""}`, at: c.resolvedAt ?? c.createdAt, status: c.status === "lost" ? "failed" : "cancelled" })),
      ...league.claims.filter((c) => c.status === "pending").map((c) => ({ id: `p-${c.id}`, text: `Claim for ${athlete(c.addId)?.name ?? "?"}`, at: c.createdAt, status: "pending" })),
      ...league.trades.filter((t) => (t.fromId === league.me || t.toId === league.me) && t.status !== "accepted" && t.status !== "vetoed").map((t) => ({ id: `t-${t.id}`, text: `Trade with ${team(t.fromId === league.me ? t.toId : t.fromId)?.teamName ?? "?"}`, at: t.resolvedAt ?? t.createdAt, status: t.status === "review" ? "pending" : t.status })),
    ] : []),
  ].sort((a, b) => b.at - a.at);
  const statusClass = (s: string): string => s === "completed" ? "bg-td-green/15 text-td-green" : s === "pending" ? "bg-td-waiver/15 text-td-waiver" : s === "failed" || s === "vetoed" || s === "declined" ? "bg-td-red/15 text-td-red" : "bg-td-surface2 text-muted-foreground";
  const names = (ids: string[]): string => ids.map((id) => athlete(id)?.name ?? "?").join(", ") || "nothing";
  const openTrades = league.trades.filter((t) => t.status === "pending" || t.status === "review");
  const pendingClaims = league.claims.filter((c) => c.status === "pending");

  return (
    <div>
      <PageHeader title="Activity" right={league.phase === "season" ? <Button className="rounded-full font-bold" onClick={() => setTradeOpen(true)}><ArrowLeftRight /> Propose trade</Button> : undefined} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <Panel title={`Trades (${openTrades.length} open)`}>
            {league.trades.length === 0 ? <p className="text-sm text-muted-foreground">No trades yet.</p> : (
              <div className="space-y-3">
                {[...league.trades].reverse().slice(0, 20).map((t) => {
                  const incoming = t.toId === league.me && t.status === "pending";
                  const outgoing = t.fromId === league.me && t.status === "pending";
                  const review = t.status === "review" && t.fromId !== league.me && t.toId !== league.me;
                  return (
                    <div key={t.id} className="rounded-xl bg-td-surface2 p-3 text-sm">
                      <div className="flex justify-between"><span className="font-semibold">{team(t.fromId)?.teamName} → {team(t.toId)?.teamName}</span><span className={cn("text-xs font-black uppercase", t.status === "accepted" ? "text-td-green" : t.status === "pending" || t.status === "review" ? "text-td-gold" : "text-td-faint")}>{t.status}</span></div>
                      <p className="mt-1 text-muted-foreground">Gives {names(t.give)} for {names(t.get)}</p>
                      {t.message && <p className="mt-1 italic text-muted-foreground">"{t.message}"</p>}
                      <div className="mt-2 flex gap-2">
                        {incoming && <><Button size="sm" disabled={busy} onClick={() => act({ type: "respondTrade", tradeId: t.id, accept: true }, "Trade accepted")}>Accept</Button><Button size="sm" variant="secondary" onClick={() => act({ type: "respondTrade", tradeId: t.id, accept: false }, "Trade declined")}>Decline</Button></>}
                        {outgoing && <Button size="sm" variant="secondary" onClick={() => act({ type: "cancelTrade", tradeId: t.id }, "Trade cancelled")}>Cancel</Button>}
                        {review && (isCommish || league.settings.tradeReview === "league") && <>
                          {isCommish && <Button size="sm" onClick={() => act({ type: "reviewTrade", tradeId: t.id, approve: true, override: true }, "Trade approved")}>Approve</Button>}
                          <Button size="sm" variant="secondary" onClick={() => act({ type: "reviewTrade", tradeId: t.id, approve: false, override: isCommish }, "Veto recorded")}>Veto</Button>
                        </>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
          <Panel title="My waiver claims">
            {pendingClaims.length === 0 ? <p className="text-sm text-muted-foreground">No pending claims. Claim players on waivers from Players.</p> : pendingClaims.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>Add <b>{athlete(c.addId)?.name}</b>{c.dropId ? `, drop ${athlete(c.dropId)?.name}` : ""}{league.settings.waiverType === "faab" ? ` • $${c.bid}` : ""}</span>
                <Button size="sm" variant="ghost" onClick={() => act({ type: "cancelClaim", claimId: c.id }, "Claim cancelled")}>Cancel</Button>
              </div>
            ))}
          </Panel>
        </div>
        <Panel title="Transactions" pad={false}>
          <div className="flex gap-2 border-b border-border px-4 py-2.5">
            {([["mine", "My Moves"], ["league", "League"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setScope(k)} className={cn("rounded-full px-3 py-1 text-sm font-semibold", scope === k ? "bg-td-green text-black" : "bg-td-surface2 text-muted-foreground")}>{l}</button>
            ))}
          </div>
          <ul className="max-h-[640px] divide-y divide-border overflow-y-auto">
            {txRows.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{scope === "mine" ? "Your moves show up here." : "No league moves yet."}</li>}
            {txRows.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span>{t.text}</span><span className="flex shrink-0 items-center gap-2"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", statusClass(t.status))}>{t.status}</span><span className="text-xs text-td-faint">{timeAgo(t.at)}</span></span></li>
            ))}
          </ul>
        </Panel>
      </div>
      <TradeDialog open={tradeOpen} onClose={() => setTradeOpen(false)} />
    </div>
  );
}

function TradeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { league, team, athlete, act, busy, myTeam } = useLeague();
  const [toId, setToId] = useState<string>("");
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("");
  const them = team(toId);
  const toggle = (list: string[], set: (v: string[]) => void, id: string): void => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const pick = (ids: string[], sel: string[], set: (v: string[]) => void) => (
    <div className="space-y-1">
      {ids.map((id) => (
        <label key={id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm", sel.includes(id) ? "bg-td-green/15" : "hover:bg-td-surface2")}>
          <input type="checkbox" checked={sel.includes(id)} onChange={() => toggle(sel, set, id)} className="accent-[hsl(var(--td-green))]" />{athlete(id)?.name}{league.locks[id] ? " 🔒" : ""}
        </label>
      ))}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-display text-3xl">Propose a trade</DialogTitle></DialogHeader>
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={toId} onChange={(e) => { setToId(e.target.value); setGet([]); }}>
          <option value="">Choose a team</option>
          {league.teams.filter((t) => t.id !== league.me).map((t) => <option key={t.id} value={t.id}>{t.teamName}</option>)}
        </select>
        {them && myTeam && (
          <div className="grid grid-cols-2 gap-4">
            <div><p className="eyebrow mb-1">You give</p>{pick(myTeam.roster, give, setGive)}</div>
            <div><p className="eyebrow mb-1">You get</p>{pick(them.roster, get, setGet)}</div>
          </div>
        )}
        <Input placeholder="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={140} />
        <DialogFooter>
          <Button className="font-bold" disabled={busy || !toId || (give.length === 0 && get.length === 0)} onClick={async () => { if (await act({ type: "proposeTrade", toId, give, get, message }, "Trade sent")) { onClose(); setGive([]); setGet([]); setMessage(""); } }}>Send trade</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Alerts() {
  const { league, act } = useLeague();
  return (
    <div>
      <PageHeader title="Notifications" right={<Button variant="secondary" className="rounded-full" onClick={() => act({ type: "markRead", all: true })}><CheckCheck /> Mark all read</Button>} />
      {league.notifications.length === 0 ? <Empty icon={<Bell className="h-9 w-9" />} title="All caught up" /> : (
        <Panel pad={false}>
          {[...league.notifications].reverse().map((n) => (
            <div key={n.id} className={cn("flex gap-3 border-b border-border px-4 py-3 last:border-0", !n.read && "bg-td-green/[0.05]")}>
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-td-green")} />
              <div className="flex-1"><p className="font-semibold">{n.title}</p><p className="text-sm text-muted-foreground">{n.body}</p></div>
              <span className="shrink-0 text-xs text-td-faint">{timeAgo(n.at)}</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
