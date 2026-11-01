/**
 * Read-only scoring audit and balance study on REAL results.
 *
 * Every number here comes from the real scoring engine (computeLines) run over the league's stored results.
 * Nothing is saved, published or changed: callers get a report only.
 *
 *   maxBreakdown   — highest possible score for one individual event, category by category (live rules + tables).
 *   auditLines     — how often categories stack on the same performance, plus correctness invariants.
 *   scenarios      — Baseline vs Test A (no redundant place-type stacking) vs Test B (participation 2), same athletes/meets.
 */
import { computeLines, eventInfo, keyOf, type Line, type PerformanceRule, type Result, type ScoringConfig, type ScoringInput, type Standard } from "./scoring";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

// MARK: - Maximum

export function maxBreakdown(rules: ScoringConfig, performance: PerformanceRule[], standards: Standard[], season: number): Record<string, unknown> {
  const on = (c: string): boolean => rules.enabled?.[c] !== false;
  const perfMax = Math.max(0, ...performance.filter((p) => p.active && p.season === season && (p.until === undefined || p.until === null)).map((p) => p.points));
  const stdMax = Math.min(rules.standardCap, Math.max(0, ...standards.filter((s) => s.active && s.season === season && (s.until === undefined || s.until === null)).map((s) => s.points)));
  const rows = [
    { code: "part", label: "Participation", points: on("part") ? rules.participation : 0, note: "Every athlete, every event entered (per relay leg too)." },
    { code: "place", label: "Overall place (1st)", points: on("place") ? Math.max(0, ...rules.overall) : 0, note: "Official overall place in the event." },
    { code: "heat", label: "Heat / flight place (1st)", points: on("heat") ? Math.max(0, ...rules.heat) : 0, note: "Place within the athlete's own heat or flight. The winner of the fastest heat is usually also 1st overall." },
    { code: "pct", label: "Seeded percentile (top 5%)", points: on("pct") ? Math.max(0, ...rules.percentile.map((t) => t.pts)) : 0, note: "Overall place ÷ field size. Needs a field of 20+ for a top-5% tier (1st of 20)." },
    { code: "perf", label: "Time / mark table (top tier)", points: on("perf") ? perfMax : 0, note: `Highest active ${season} table tier.` },
    { code: "best", label: "Personal best", points: on("best") ? Math.max(rules.pb, rules.sb) : 0, note: "PB or SB, never both (PB pays the PB value only)." },
    { code: "std", label: "National / state standard", points: on("std") ? stdMax : 0, note: `Highest standard, capped at ${rules.standardCap} per athlete per SEASON (upgrades pay the difference). Only the first qualifying event can carry it.` },
    { code: "sr", label: "School record", points: on("sr") ? rules.schoolRecord : 0, note: "Commissioner-confirmed, once per athlete/event/season." },
  ];
  const total = rows.reduce((t, r) => t + r.points, 0);
  const placeTypes = rows.filter((r) => r.code === "place" || r.code === "heat" || r.code === "pct").reduce((t, r) => t + r.points, 0);
  const everyMeet = rows.filter((r) => r.code !== "std" && r.code !== "sr").reduce((t, r) => t + r.points, 0);
  return {
    rows, total, placeRelatedTotal: placeTypes,
    repeatableMax: everyMeet,
    explanation: [
      `Theoretical one-event maximum: ${rows.map((r) => `${r.label} ${r.points}`).join(" + ")} = ${total}.`,
      `Without the one-off categories (standard ${rows.find((r) => r.code === "std")?.points ?? 0}, school record ${rows.find((r) => r.code === "sr")?.points ?? 0}), the most a single event can pay at any meet is ${everyMeet}.`,
      `Three categories reward finishing position in the same race: overall place ${rows[1]?.points}, heat place ${rows[2]?.points}, percentile ${rows[3]?.points} = ${placeTypes} points for one win.`,
    ],
  };
}

// MARK: - Stacking + correctness

type Group = { r: Result; aid: string; codes: Map<string, number>; total: number };

function groupLines(lines: Line[], byId: Map<string, Result>): Group[] {
  const m = new Map<string, Group>();
  for (const l of lines) {
    const r = byId.get(l.sourceId);
    if (!r) continue;
    const k = `${l.sourceId}|${l.athleteId}`;
    const g = m.get(k) ?? { r, aid: l.athleteId, codes: new Map<string, number>(), total: 0 };
    g.codes.set(l.code, (g.codes.get(l.code) ?? 0) + l.points);
    g.total += l.points;
    m.set(k, g);
  }
  return [...m.values()];
}

export function auditLines(base: ScoringInput, lines: Line[]): Record<string, unknown> {
  const R = base.rulesFor?.(1);
  const byId = new Map(base.results.map((r) => [r.id, r]));
  const groups = groupLines(lines, byId);
  const ind = groups.filter((g) => !g.r.relay && g.r.status === "OK");
  const has = (g: Group, c: string): boolean => (g.codes.get(c) ?? 0) !== 0;
  const pctOf = (n: number): number => (ind.length ? round2((n / ind.length) * 100) : 0);
  const count = (f: (g: Group) => boolean): { n: number; pct: number } => { const n = ind.filter(f).length; return { n, pct: pctOf(n) }; };
  const winners = ind.filter((g) => g.r.place === 1);
  const stacking = {
    individualResults: ind.length,
    place: count((g) => has(g, "place")),
    heat: count((g) => has(g, "heat")),
    percentile: count((g) => has(g, "pct")),
    placeAndPercentile: count((g) => has(g, "place") && has(g, "pct")),
    percentileWithoutPlace: count((g) => has(g, "pct") && !has(g, "place")),
    placeAndHeat: count((g) => has(g, "place") && has(g, "heat")),
    heatSameAsOverall: count((g) => has(g, "heat") && g.r.heatPlace !== null && g.r.heatPlace === g.r.place),
    placeHeatPercentile: count((g) => has(g, "place") && has(g, "heat") && has(g, "pct")),
    perfAndPlace: count((g) => has(g, "perf") && has(g, "place")),
    bestAndPlace: count((g) => has(g, "best") && has(g, "place")),
    standardAndPlace: count((g) => has(g, "std") && has(g, "place")),
    winners: winners.length,
    winnersAlsoHeat1: winners.filter((g) => g.r.heatPlace === 1).length,
    winnersAlsoTopPct: winners.filter((g) => has(g, "pct")).length,
    avgWinnerPlaceTypePoints: round2(mean(winners.map((g) => (g.codes.get("place") ?? 0) + (g.codes.get("heat") ?? 0) + (g.codes.get("pct") ?? 0)))),
    placeTypeShareOfAllPoints: round2((ind.reduce((t, g) => t + (g.codes.get("place") ?? 0) + (g.codes.get("heat") ?? 0) + (g.codes.get("pct") ?? 0), 0) / Math.max(1, ind.reduce((t, g) => t + g.total, 0))) * 100),
    redundantPoints: round2(ind.reduce((t, g) => {
      // Points that Test A would remove: the smaller of place/percentile + heat points when heat place = overall place.
      const pl = g.codes.get("place") ?? 0; const pc = g.codes.get("pct") ?? 0;
      return t + (pl && pc ? Math.min(pl, pc) : 0) + (has(g, "heat") && g.r.heatPlace === g.r.place ? (g.codes.get("heat") ?? 0) : 0);
    }, 0)),
    topEvents: [...ind].sort((a, b) => b.total - a.total).slice(0, 10).map((g) => ({
      athleteId: g.aid, event: eventInfo(g.r.event).name, meet: g.r.meet, date: g.r.date, mark: g.r.mark, place: g.r.place, heatPlace: g.r.heatPlace, seeded: g.r.seeded,
      total: round2(g.total), lines: Object.fromEntries([...g.codes.entries()].map(([k, v]) => [k, round2(v)])),
    })),
  };

  // Correctness invariants (each should be 0 unless stated).
  const ids = new Map<string, number>();
  for (const l of lines) ids.set(l.id, (ids.get(l.id) ?? 0) + 1);
  const bestKinds = new Map<string, Set<string>>();
  for (const l of lines) if (l.code === "best") { const k = `${l.sourceId}|${l.athleteId}`; bestKinds.set(k, (bestKinds.get(k) ?? new Set<string>()).add(l.label.startsWith("Personal") ? "pb" : "sb")); }
  const bestBoth = [...bestKinds.values()].filter((s) => s.size > 1).length;
  const partPer = new Map<string, number>();
  for (const l of lines) if (l.code === "part") partPer.set(`${l.sourceId}|${l.athleteId}`, (partPer.get(`${l.sourceId}|${l.athleteId}`) ?? 0) + 1);
  const scored = base.results.filter((r) => !r.historyOnly);
  const expectedPart = scored.reduce((t, r) => t + r.athleteIds.length, 0);
  const relayLegs = scored.filter((r) => r.relay).reduce((t, r) => t + r.athleteIds.length, 0);
  const stdBy = new Map<string, number>();
  for (const l of lines) if (l.code === "std") { const k = `${l.athleteId}|${l.season ?? ""}`; stdBy.set(k, (stdBy.get(k) ?? 0) + l.points); }
  const cap = R?.standardCap ?? 20;
  const srBy = new Map<string, number>();
  for (const l of lines) if (l.code === "sr") { const k = `${l.athleteId}|${keyOf(l.event)}|${l.season ?? l.date.slice(0, 4)}`; srBy.set(k, (srBy.get(k) ?? 0) + 1); }
  const dq = lines.filter((l) => l.code === "dq");
  const dqResults = scored.filter((r) => r.status !== "OK").reduce((t, r) => t + r.athleteIds.length, 0);
  const checks = [
    { name: "PB and SB never both paid on one result", ok: bestBoth === 0, detail: `${bestBoth} results paid both` },
    { name: "No duplicate scoring lines", ok: [...ids.values()].every((n) => n === 1), detail: `${[...ids.values()].filter((n) => n > 1).length} duplicated line ids of ${lines.length}` },
    { name: "Participation paid once per athlete per event", ok: [...partPer.values()].every((n) => n === 1) && partPer.size === expectedPart, detail: `${partPer.size} participation lines for ${expectedPart} athlete-events (relays: ${relayLegs} legs, each leg earns participation)` },
    { name: `Standards capped at ${cap} per athlete per season`, ok: [...stdBy.values()].every((v) => v <= cap + 1e-9), detail: `${stdBy.size} athletes earned standards; highest season total ${Math.max(0, ...stdBy.values())}` },
    { name: "School record paid once per athlete/event/season", ok: [...srBy.values()].every((n) => n === 1), detail: `${srBy.size} school-record lines` },
    { name: "DQ/DNF penalty on every DQ/DNF (and nothing else)", ok: dq.length === dqResults && dq.every((l) => l.points === R?.dqdnf), detail: `${dq.length} penalty lines for ${dqResults} DQ/DNF athlete-results at ${R?.dqdnf ?? "?"} each` },
    { name: "Fumble penalties", ok: lines.filter((l) => l.code === "fumble").every((l) => l.points === R?.fumble), detail: `${lines.filter((l) => l.code === "fumble").length} fumble lines at ${R?.fumble ?? "?"} each` },
  ];
  const maxObserved = round2(Math.max(0, ...ind.map((g) => g.total)));
  // Prelim + final of the same event at the same meet: each round is scored as its own event today.
  const roundsBy = new Map<string, Group[]>();
  for (const g of ind) { const k = `${g.aid}|${g.r.date}|${keyOf(g.r.meet)}|${eventInfo(g.r.event).name}`; roundsBy.set(k, [...(roundsBy.get(k) ?? []), g]); }
  const multi = [...roundsBy.values()].filter((gs) => gs.length > 1);
  const earlier = multi.flatMap((gs) => [...gs].sort((a, b) => (a.r.seq ?? 1) - (b.r.seq ?? 1)).slice(0, -1));
  const rounds = {
    athleteEventsWithTwoRounds: multi.length,
    pointsFromEarlierRounds: round2(earlier.reduce((t, g) => t + g.total, 0)),
    placeTypePointsFromEarlierRounds: round2(earlier.reduce((t, g) => t + (g.codes.get("place") ?? 0) + (g.codes.get("heat") ?? 0) + (g.codes.get("pct") ?? 0), 0)),
    examples: multi.slice(0, 5).map((gs) => ({ athleteId: gs[0]?.aid, event: eventInfo(gs[0]?.r.event ?? "").name, date: gs[0]?.r.date, rounds: gs.map((g) => ({ round: g.r.round ?? (g.r.seq === 0 ? "PRELIM" : "FINAL"), mark: g.r.mark, place: g.r.place, total: round2(g.total) })) })),
  };
  return { stacking, checks, maxObserved, rounds };
}

// MARK: - Scenarios

export type Scenario = "baseline" | "testA" | "testB";

/** Test A: pay the larger of overall place / percentile (not both); pay heat place only when it differs from overall place. */
export function applyTestA(lines: Line[], byId: Map<string, Result>): Line[] {
  const groups = new Map<string, Line[]>();
  for (const l of lines) groups.set(`${l.sourceId}|${l.athleteId}`, [...(groups.get(`${l.sourceId}|${l.athleteId}`) ?? []), l]);
  const drop = new Set<string>();
  for (const ls of groups.values()) {
    const r = byId.get(ls[0]?.sourceId ?? "");
    if (!r) continue;
    const pl = ls.find((l) => l.code === "place"); const pc = ls.find((l) => l.code === "pct"); const ht = ls.find((l) => l.code === "heat");
    if (pl && pc) drop.add(pc.points > pl.points ? pl.id : pc.id);
    if (ht && r.heatPlace !== null && r.heatPlace === r.place) drop.add(ht.id);
  }
  return lines.filter((l) => !drop.has(l.id));
}

export function scenarioLines(base: ScoringInput, which: Scenario): Line[] {
  if (which === "testB") {
    const rf = base.rulesFor;
    return computeLines({ ...base, rulesFor: (w: number): ScoringConfig => ({ ...(rf ? rf(w) : ({} as ScoringConfig)), participation: 2 }) });
  }
  const lines = computeLines(base);
  return which === "testA" ? applyTestA(lines, new Map(base.results.map((r) => [r.id, r]))) : lines;
}

export type Game = { week: number; home: string[]; away: string[] | null; label: string };

export function scenarioMetrics(base: ScoringInput, lines: Line[], opts: { rounds: Map<string, number>; games: Game[]; teams: number; baseline?: { totals: Map<string, number>; winners: Map<string, number>; athleteMeet: Map<string, number> } }): { metrics: Record<string, unknown>; totals: Map<string, number>; winners: Map<string, number>; athleteMeet: Map<string, number> } {
  const byId = new Map(base.results.map((r) => [r.id, r]));
  const groups = groupLines(lines, byId);
  const perEvent = groups.map((g) => g.total);
  const athleteMeet = new Map<string, number>();
  const athleteWeek = new Map<string, number>();
  for (const g of groups) {
    const k = `${g.aid}|${g.r.date}|${keyOf(g.r.meet)}`;
    athleteMeet.set(k, (athleteMeet.get(k) ?? 0) + g.total);
    athleteWeek.set(`${g.aid}|${g.r.week}`, (athleteWeek.get(`${g.aid}|${g.r.week}`) ?? 0) + g.total);
  }
  const totals = new Map<string, number>();
  const meetsBy = new Map<string, number>();
  for (const [k, v] of athleteMeet) { const aid = k.split("|")[0] as string; totals.set(aid, (totals.get(aid) ?? 0) + v); meetsBy.set(aid, (meetsBy.get(aid) ?? 0) + 1); }
  const perMeetAvg = [...totals.entries()].map(([aid, t]) => ({ aid, avg: t / (meetsBy.get(aid) ?? 1) })).sort((a, b) => b.avg - a.avg);
  const eliteN = Math.max(1, Math.round(perMeetAvg.length * 0.1));
  const elite = mean(perMeetAvg.slice(0, eliteN).map((x) => x.avg));
  const mid = median(perMeetAvg.map((x) => x.avg));
  const bucket = (lo: number, hi: number): number => round2((perEvent.filter((x) => x >= lo && x < hi).length / Math.max(1, perEvent.length)) * 100);
  // A "placer" finished in the paid places (top 6) of the official result, whatever the scenario pays for it.
  const placed = (g: Group): boolean => typeof g.r.place === "number" && g.r.place >= 1 && g.r.place <= 6;
  const nonPlacers = groups.filter((g) => !placed(g));
  const total = perEvent.reduce((a, b) => a + b, 0);
  const vals = [...athleteMeet.values()];
  // Matchups: starters' points in that week's meets.
  const winners = new Map<string, number>();
  let flips = 0;
  const sideTotal = (ids: string[], week: number): number => ids.reduce((t, id) => t + (athleteWeek.get(`${id}|${week}`) ?? 0), 0);
  for (const g of opts.games) {
    if (!g.away) continue;
    const d = sideTotal(g.home, g.week) - sideTotal(g.away, g.week);
    const w = Math.abs(d) < 1e-6 ? 0 : d > 0 ? 1 : -1;
    winners.set(`${g.week}|${g.label}`, w);
    const b = opts.baseline?.winners.get(`${g.week}|${g.label}`);
    if (b !== undefined && b !== w) flips++;
  }
  // Draft rounds (real test-draft positions) and a season-rank proxy (rank by baseline season total, grouped by team count).
  const byRound = new Map<number, number[]>();
  for (const x of perMeetAvg) { const rd = opts.rounds.get(x.aid); if (rd !== undefined) byRound.set(rd, [...(byRound.get(rd) ?? []), x.avg]); }
  const rankSrc = opts.baseline?.totals ?? totals;
  const ranked = [...rankSrc.entries()].sort((a, b) => b[1] - a[1]).map(([aid]) => aid);
  const proxy = new Map<number, number[]>();
  const avgOf = new Map(perMeetAvg.map((x) => [x.aid, x.avg]));
  ranked.forEach((aid, i) => { const tier = Math.floor(i / Math.max(1, opts.teams)) + 1; if (tier <= 8) proxy.set(tier, [...(proxy.get(tier) ?? []), avgOf.get(aid) ?? 0]); });
  const baseTotal = opts.baseline ? [...opts.baseline.athleteMeet.values()].reduce((a, b) => a + b, 0) : total;
  return {
    totals, winners, athleteMeet,
    metrics: {
      athletes: totals.size, athleteMeets: athleteMeet.size, events: perEvent.length, totalPoints: round2(total),
      perAthleteMeet: { mean: round2(mean(vals)), median: round2(median(vals)) },
      perEvent: { mean: round2(mean(perEvent)), median: round2(median(perEvent)), max: round2(Math.max(0, ...perEvent)) },
      eventBuckets: { "0-3": bucket(-1e9, 3.5), "4-7": bucket(3.5, 7.5), "8-12": bucket(7.5, 12.5), "13+": bucket(12.5, 1e9) },
      eliteVsAverage: { eliteTop10PctPerMeet: round2(elite), medianAthletePerMeet: round2(mid), ratio: mid > 0 ? round2(elite / mid) : null, gap: round2(elite - mid) },
      nonPlacers: { events: nonPlacers.length, sharePct: round2((nonPlacers.length / Math.max(1, groups.length)) * 100), meanPoints: round2(mean(nonPlacers.map((g) => g.total))), shareOfPointsPct: round2((nonPlacers.reduce((t, g) => t + g.total, 0) / Math.max(1e-9, total)) * 100) },
      inflationPct: round2(((total - baseTotal) / Math.max(1e-9, baseTotal)) * 100),
      matchups: { games: [...winners.keys()].length, flipsVsBaseline: opts.baseline ? flips : null },
      draftRounds: [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, xs]) => ({ round, athletes: xs.length, meanPerMeet: round2(mean(xs)) })),
      seasonRankProxy: [...proxy.entries()].sort((a, b) => a[0] - b[0]).map(([tier, xs]) => ({ tier, athletes: xs.length, meanPerMeet: round2(mean(xs)) })),
    },
  };
}
