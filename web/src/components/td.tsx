import { memo, type ReactNode } from "react";
import { Globe2, Lock } from "lucide-react";

import { absUrl, avatarUrl } from "@/lib/api";
import type { Athlete, Team } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Launch/loading screen matching the iOS splash: deep green gradient, glow, logo rising, green line drawing in. */
export function SplashScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ background: "linear-gradient(180deg, #04140B 0%, #0B2A18 100%)" }} aria-label={label} role="status">
      <div className="td-glow pointer-events-none absolute h-[520px] w-[520px] rounded-full" style={{ background: "radial-gradient(circle, rgba(32,196,99,0.32) 0%, transparent 60%)" }} />
      <img src="/icon.png" alt="" className="td-rise relative h-28 w-28 rounded-[30px] shadow-[0_12px_40px_rgba(32,196,99,0.45)]" />
      <p className="td-rise font-display relative mt-6 text-4xl tracking-[0.18em] text-[#E8F5EC]" style={{ animationDelay: "0.1s" }}>T&amp;F FANTASY</p>
      <div className="td-draw relative mt-3 h-[3px] rounded-full" style={{ background: "linear-gradient(90deg, rgba(32,196,99,0.2), #20C463, rgba(32,196,99,0.2))" }} />
      <p className="td-rise relative mt-3 text-sm font-semibold text-[#E8F5EC]/55" style={{ animationDelay: "0.45s" }}>Track &amp; Field, drafted.</p>
    </div>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return <img src="/icon.png" alt="T&F Fantasy" className={cn("h-9 w-9 rounded-xl", className)} />;
}

export const TeamAvatar = memo(function TeamAvatar({ team, leagueId, size = 36 }: { team?: Team; leagueId: string; size?: number }) {
  const url = team ? avatarUrl(leagueId, team.id, team.avatarAt) : null;
  const initials = (team?.teamName ?? "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-xl font-display text-black" style={{ width: size, height: size, background: team?.color ?? "#5F6B73", fontSize: size * 0.42 }}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials}
    </div>
  );
});

const POS_COLOR: Record<string, string> = { SPR: "bg-td-spr", DIS: "bg-td-dis", FLD: "bg-td-fld", FLEX: "bg-td-flex" };

export const AthleteAvatar = memo(function AthleteAvatar({ athlete, size = 36 }: { athlete?: Athlete; size?: number }) {
  const photo = absUrl(athlete?.photo);
  const main = athlete?.flex ? "FLEX" : athlete?.positions[0] ?? "FLEX";
  const initials = (athlete?.name ?? "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="relative grid shrink-0 place-items-center overflow-hidden bg-td-surface2 font-display text-foreground ring-1 ring-white/10" style={{ width: size, height: size, fontSize: size * 0.38, borderRadius: Math.max(4, size * 0.14) }}>
      {photo ? <img src={photo} alt="" className="h-full w-full object-cover" loading="lazy" /> : initials}
      <span className={cn("absolute inset-x-0 bottom-0", POS_COLOR[main] ?? "bg-td-raised")} style={{ height: Math.max(2, size * 0.06) }} />
    </div>
  );
});

export function PosTag({ position, className }: { position: string; className?: string }) {
  const parts = position.split("/");
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {parts.map((p) => (
        <span key={p} className={cn("rounded px-1.5 py-px text-[10px] font-black tracking-wide text-black", POS_COLOR[p] ?? "bg-td-raised text-foreground")}>{p}</span>
      ))}
    </span>
  );
}

export function StatusTag({ status }: { status?: string }) {
  if (!status || status === "active") return null;
  const label = status === "Q" ? "Q" : status === "D" ? "D" : status === "O" ? "O" : "IR";
  return <span title={status === "D" ? "Doubtful" : undefined} className={cn("rounded px-1 text-[10px] font-black", status === "Q" ? "bg-td-gold/20 text-td-gold" : status === "D" ? "bg-orange-400/20 text-orange-300" : "bg-td-red/20 text-td-red")}>{label}</span>;
}

export function LiveDot({ className }: { className?: string }) {
  return <span className={cn("td-live-dot inline-block h-2 w-2 rounded-full bg-td-red", className)} />;
}

export function LockBadge({ title }: { title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-md bg-td-gold/15 px-1.5 py-0.5 text-[10px] font-black text-td-gold">
      <Lock className="h-3 w-3" /> LOCKED
    </span>
  );
}

export function MainLeagueBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-td-gold/25 bg-td-gold/[0.06] p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-td-gold/15 text-td-gold"><Globe2 className="h-5 w-5" /></div>
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-td-gold">Set by the Main League</p>
        <p className="mt-0.5 text-sm text-foreground/85">{children}</p>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, right, sub }: { eyebrow?: string; title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="font-display text-4xl leading-none md:text-5xl">{title}</h1>
        {sub && <div className="mt-2 text-sm text-muted-foreground">{sub}</div>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-td-green">{icon}</div>}
      <p className="font-display text-2xl">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Panel({ title, right, children, className, pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {(title || right) && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted-foreground">{title}</h2>
          {right}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "green" | "gold" | "red" }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={cn("num text-3xl leading-tight", tone === "green" && "text-td-green", tone === "gold" && "text-td-gold", tone === "red" && "text-td-red")}>{value}</p>
    </div>
  );
}
