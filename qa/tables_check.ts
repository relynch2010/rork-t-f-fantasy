/**
 * Table integrity: every live performance tier (all events, both genders, season 2026) scored through the real
 * scoring engine with a mark exactly at the tier, just better, and just worse. Run: bun qa/tables_check.ts /tmp/qa_export.json
 * (the export comes from the test league's read-only scoringExport). Writes qa/results/tables_check.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { computeLines, DEFAULT_SCORING, EVENT_NAMES, eventInfo, keyOf, measureForEvent, measurementTypeOf, type PerformanceRule, type Result } from "../functions/scoring";

type Row = [number, string, string, number, number, string];
const ex = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/qa_export.json", "utf8")) as { performance: Record<string, Row[]> };
const week = Math.max(...Object.keys(ex.performance).map(Number));
const rows = ex.performance[String(week)].filter((r) => r[0] === 2026);
const nameOf = (k: string): string => EVENT_NAMES.find((n) => keyOf(n) === k) ?? k;
const perf: PerformanceRule[] = rows.map((r, i) => ({
  id: `t${i}`, season: r[0], gender: r[1] as "B" | "G" | "X", event: nameOf(r[2]), measurement: measurementTypeOf(nameOf(r[2])),
  mark: r[5], value: r[3], points: r[4], active: true, updatedAt: 0,
}));
const rules = { ...DEFAULT_SCORING, participation: 0, pb: 0, sb: 0, enabled: { part: false, best: false, pct: false, place: false, heat: false, std: false } };

const fmt = (v: number, timed: boolean): string => {
  if (timed) {
    const m = Math.floor(v / 60);
    const s = v - m * 60;
    return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
  }
  return `${v.toFixed(2)}m`;
};
const score = (event: string, gender: "B" | "G", mark: string): number => {
  const r: Result = { id: "r", key: "r", week, meet: "check", date: "2026-01-10", event, gender, athleteIds: ["a"], relay: false, mark, place: null, heatPlace: null, seeded: null, status: "OK", best: "none", enteredAt: 0, source: "form", season: 2026 };
  return computeLines({ results: [r], records: [], fumbles: [], standards: [], performance: perf, pbs: {}, season: 2026, rulesFor: () => rules, ruleActive: () => true })
    .filter((l) => l.code === "perf").reduce((s, l) => s + l.points, 0);
};

const problems: string[] = [];
const groups = new Map<string, PerformanceRule[]>();
for (const p of perf) {
  const k = `${p.gender} ${p.event}`;
  groups.set(k, [...(groups.get(k) ?? []), p]);
}
let checked = 0;
for (const [k, tiers] of groups) {
  const event = tiers[0].event;
  const timed = eventInfo(event).kind === "time";
  if (eventInfo(event).name !== event) problems.push(`${k}: event name not in catalog`);
  const genders: ("B" | "G")[] = tiers[0].gender === "X" ? ["B", "G"] : [tiers[0].gender as "B" | "G"];
  const sorted = [...tiers].sort((a, b) => (timed ? b.value - a.value : a.value - b.value)); // weakest → strongest
  for (let i = 1; i < sorted.length; i++) if (sorted[i].points <= sorted[i - 1].points) problems.push(`${k}: tier ${sorted[i].mark} (${sorted[i].points}) not above ${sorted[i - 1].mark} (${sorted[i - 1].points})`);
  for (const t of sorted) {
    const parsed = measureForEvent(t.mark, event).m?.value ?? null;
    if (parsed === null || Math.abs(parsed - t.value) > 0.005) problems.push(`${k}: tier mark ${t.mark} parses to ${String(parsed)}, stored ${t.value}`);
    const step = timed ? 0.01 : 0.01;
    for (const g of genders) {
      const want = Math.max(...sorted.filter((x) => (timed ? x.value >= t.value - 1e-9 : x.value <= t.value + 1e-9)).map((x) => x.points));
      const at = score(event, g, t.mark);
      const worse = score(event, g, fmt(timed ? t.value + step : t.value - step, timed));
      const prev = sorted[sorted.indexOf(t) - 1]?.points ?? 0;
      if (at !== want) problems.push(`${g} ${event}: mark ${t.mark} scored ${at}, expected ${want}`);
      if (worse !== prev) problems.push(`${g} ${event}: just below ${t.mark} scored ${worse}, expected ${prev}`);
      checked += 2;
    }
  }
}
const events = [...new Set(perf.map((p) => p.event))];
const out = { week, tiers: perf.length, tables: groups.size, events: events.length, checks: checked, problems, eventsList: events.sort() };
writeFileSync(new URL("./results/tables_check.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, eventsList: undefined, problems: problems.slice(0, 30), problemCount: problems.length }));
