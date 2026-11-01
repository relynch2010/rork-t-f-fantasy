import { AlertTriangle, CheckCircle2, Minus, XOctagon } from "lucide-react";

import { cn } from "@/lib/utils";

export type LabCheck = { name: string; ok: boolean; detail: string };
export type LabStep = { name: string; url: string; ok: boolean; note: string };
export type LabCounts = {
  events?: number; athletes?: number; results?: number; cornwall?: number; matched?: number; review?: number; conflicts?: number;
  unmatched?: number; rejected?: number; missingEvents?: number; duplicatesPrevented?: number; scoringLines?: number; points?: number;
};
export type LabCaps = Partial<Record<"heats" | "flights" | "overallPlaces" | "heatPlaces" | "seeds" | "wind" | "pbSb" | "fieldAttempts" | "relayLegs" | "athleteIds" | "schools" | "schedule", boolean>> & {
  events?: number; resultRows?: number; fieldEvents?: number;
};
export type LabLine = { code: string; label: string; points: number };
export type LabEvidence = {
  kind: "individual" | "relay";
  source: { sourceId?: string | null; name: string; school?: string; gender?: string | null; grade?: string; bib?: string; teamId?: string | null; members?: string[] };
  master: { id: string; name: string; school?: string; positions?: string[] } | null;
  relayMembers?: { id: string; name: string; lines?: LabLine[]; total?: number }[];
  match: { type: string; confidence: string; reason: string; candidates?: { id: string; name: string }[] };
  result: {
    meet?: string; sourceEvent: string; event: string | null; gender?: string | null; type?: string; round?: string; heat: number | null; heats?: number | null;
    heatPlace: number | null; place: number | null; mark: string; status: string; fieldSize: number | null; eventFieldSize?: number | null;
    seedMark?: string; wind?: string; sourcePb?: string; sourceSb?: string; sourceFinal?: boolean | null; best?: string | null; historyOnly?: boolean;
  };
  scoring: { scoringVersion?: number; lines: LabLine[]; total: number; resultId?: string | null };
  rawText?: string | null;
};
export type LabVerdict = { verdict?: string; message?: string; outcome?: string; identical?: boolean };
export type LabResult = {
  ok: boolean; status?: "PASS" | "WARNINGS" | "FAIL"; message?: string; error?: string; hint?: string; temporary?: boolean;
  source?: { publicUrl?: string; resolvedUrl?: string; meetId?: string | null; name?: string | null; date?: string | null; location?: string | null; timer?: string | null; sourceType?: string };
  steps?: LabStep[]; checks?: LabCheck[]; warnings?: string[]; counts?: LabCounts; capabilities?: LabCaps | null;
  events?: { name: string; event: string | null; gender: string | null; kind: string; round: string; heats: number; rows: number; fieldSize: number | null; complete: boolean; cornwall: number }[];
  evidence?: LabEvidence[]; repeat?: LabVerdict; reconcile?: LabVerdict; fault?: LabVerdict; isolation?: { unchanged: boolean };
};

export const verdictOf = (r: LabResult): "PASS" | "WARNINGS" | "FAIL" => r.status ?? (r.ok ? "PASS" : "FAIL");

const CAPS: [keyof LabCaps | "results" | "field", string][] = [
  ["results", "Results"], ["schools", "Schools"], ["athleteIds", "Athlete IDs"], ["heats", "Heats"], ["flights", "Flights"],
  ["overallPlaces", "Overall place"], ["heatPlaces", "Heat place"], ["field", "Field marks"], ["fieldAttempts", "Attempts"],
  ["relayLegs", "Relay legs"], ["pbSb", "PB / SB"], ["seeds", "Seeds"], ["wind", "Wind"], ["schedule", "Schedule"],
];

/** PASS / WARNINGS / FAIL with checks, source, data found and what's missing. Shared by Test Connection and the Test Lab. */
export function LabSummary({ result }: { result: LabResult }) {
  const v = verdictOf(result);
  const tone = v === "PASS" ? "td-green" : v === "WARNINGS" ? "td-gold" : "td-red";
  const caps = result.capabilities;
  return (
    <div className={cn("space-y-3 rounded-xl border p-4 text-sm", `border-${tone}/30 bg-${tone}/5`)}>
      <div className="flex items-center gap-2">
        <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-black tracking-wider text-black", v === "PASS" ? "bg-td-green" : v === "WARNINGS" ? "bg-td-gold" : "bg-td-red")}>{v}</span>
        {result.temporary && <span className="text-[10px] font-black text-td-gold">TEMPORARY</span>}
      </div>
      <p className="font-semibold">{result.message ?? result.error ?? "No details."}</p>
      {result.hint && <p className="text-xs text-muted-foreground">{result.hint}</p>}
      {result.source?.name && (
        <div className="text-xs">
          <p className="eyebrow">Source</p>
          <p>{[result.source.name, result.source.date, result.source.location].filter(Boolean).join(" · ")}</p>
          <p className="text-muted-foreground">{result.source.sourceType}{result.source.meetId ? ` · AthleticLIVE meet ${result.source.meetId}` : ""}</p>
        </div>
      )}
      {result.checks && result.checks.length > 0 && (
        <ul className="space-y-1">
          {result.checks.map((c) => (
            <li key={c.name} className="flex gap-2 text-xs">
              {c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-td-green" /> : <XOctagon className="h-4 w-4 shrink-0 text-td-red" />}
              <span><b>{c.name}</b> <span className="text-muted-foreground">· {c.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
      {caps && (
        <div className="flex flex-wrap gap-1.5">
          {CAPS.map(([k, label]) => {
            const on = k === "results" ? (caps.resultRows ?? 0) > 0 : k === "field" ? (caps.fieldEvents ?? 0) > 0 : !!caps[k as keyof LabCaps];
            return (
              <span key={k} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", on ? "bg-td-green/10 text-td-green" : "bg-td-surface2 text-td-faint")}>
                {on ? <CheckCircle2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}{label}
              </span>
            );
          })}
        </div>
      )}
      {result.warnings && result.warnings.length > 0 && (
        <ul className="space-y-1">
          {result.warnings.slice(0, 10).map((w, i) => <li key={i} className="flex gap-1.5 text-xs text-td-gold"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</li>)}
        </ul>
      )}
      {v === "FAIL" && result.steps && result.steps.length > 0 && (
        <div className="text-xs">
          <p className="eyebrow">What was tried</p>
          {result.steps.map((s, i) => <p key={i} className={s.ok ? "text-muted-foreground" : "text-td-red"}>{s.ok ? "✓" : "✗"} {s.name}: {s.note}</p>)}
        </div>
      )}
    </div>
  );
}
