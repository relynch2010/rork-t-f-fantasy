/**
 * Scoring labs, back-testing and schedule tools. Everything here is READ-ONLY analysis on real stored results:
 * nothing in this file writes scores, rules or schedules. Callers decide what (if anything) is ever published.
 */
import { computeLines, eventInfo, keyOf, measureForEvent, seasonOf, type Gender, type Line, type PerformanceRule, type Result, type ScoringInput } from "./scoring";
import { project, type Projection } from "./projections";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// MARK: - Field strength

export type FieldProfile = {
  /** Distinct athletes in the full field (every school). */
  size: number;
  /** 0–1: mean performance-table tier of the top-8 marks ÷ the table's top tier. null when the event has no table. */
  strength: number | null;
  /** Best → worst normalized marks across every section (actual marks, or seed marks before results post). Capped at 500. */
  marks: number[];
  /** Marks came from seed marks (entries, before results) rather than results. */
  fromSeeds: boolean;
};

type FieldRow = { who: string; gender: string | null; event: string | null; mark: string; seedMark?: string | null; status: string; relay: boolean };

/** Table tier fraction reached by a normalized mark (0 when no tier reached). null when no table exists. */
export function tierFraction(perf: PerformanceRule[], event: string, gender: Gender, season: number, value: number): number | null {
  const k = keyOf(eventInfo(event).name);
  const kind = eventInfo(event).kind;
  const rows = perf.filter((p) => p.active && p.season === season && (p.gender === "X" || p.gender === gender) && keyOf(p.event) === k && p.points > 0 && p.until == null);
  if (rows.length === 0) return null;
  const top = Math.max(...rows.map((p) => p.points));
  const reached = rows.filter((p) => (kind === "time" ? value <= p.value + 1e-5 : value >= p.value - 1e-5));
  const pts = reached.length ? Math.max(...reached.map((p) => p.points)) : 0;
  return top > 0 ? pts / top : null;
}

/** Profiles every individual event's complete field (size, strength, sorted marks) from one meet's normalized rows. */
export function profileFields(rows: FieldRow[], perf: PerformanceRule[], season: number): Record<string, FieldProfile> {
  const by = new Map<string, Map<string, { v: number; seed: boolean }>>();
  for (const r of rows) {
    if (r.relay || !r.event || !r.gender) continue;
    const info = eventInfo(r.event);
    if (info.kind === "points") continue;
    const key = `${r.gender}|${info.name}`;
    const m = by.get(key) ?? new Map<string, { v: number; seed: boolean }>();
    by.set(key, m);
    const okMark = r.status === "OK" && r.mark ? measureForEvent(r.mark, info.name).m?.value ?? null : null;
    const seed = r.seedMark ? measureForEvent(r.seedMark, info.name).m?.value ?? null : null;
    const v = okMark ?? seed;
    const cur = m.get(r.who);
    if (v === null) { if (!cur) m.set(r.who, { v: Number.NaN, seed: true }); continue; }
    const better = (a: number, b: number): boolean => (info.kind === "time" ? a < b : a > b);
    if (!cur || Number.isNaN(cur.v) || better(v, cur.v)) m.set(r.who, { v, seed: okMark === null });
  }
  const out: Record<string, FieldProfile> = {};
  for (const [key, m] of by) {
    const [g, ev] = key.split("|") as [Gender, string];
    const kind = eventInfo(ev).kind;
    const vals = [...m.values()].filter((x) => !Number.isNaN(x.v));
    const marks = vals.map((x) => x.v).sort((a, b) => (kind === "time" ? a - b : b - a));
    const top = marks.slice(0, 8).map((v) => tierFraction(perf, ev, g, season, v));
    const known = top.filter((x): x is number => x !== null);
    out[key] = {
      size: m.size, marks: marks.slice(0, 500).map((v) => Math.round(v * 1000) / 1000),
      strength: known.length > 0 ? round2(mean(known)) : null, fromSeeds: vals.length > 0 && vals.every((x) => x.seed),
    };
  }
  return out;
}

// MARK: - Shared helpers

/** Lab copy of real results: every verified pool result scores (history flags off), 2025-26 indoor uses 2026 tables. */
export function labResults(results: Result[]): { results: Result[]; seasonNote: string | null } {
  let remapped = 0;
  const out = results.filter((r) => r.provisional !== true).map((r) => {
    const s = r.season ?? seasonOf(r.date, 2026);
    // The authoritative tables start with the 2026 season; the 2025-26 indoor season (Nov 2025+) is scored on them.
    const season = s < 2026 && r.date >= "2025-11-01" ? 2026 : s;
    if (season !== s) remapped++;
    return { ...r, historyOnly: false, season };
  });
  return { results: out, seasonNote: remapped > 0 ? `${remapped} results from the 2025-26 indoor season were scored on the 2026 season tables (the earliest authoritative tables).` : null };
}

const meetKey = (r: { meet: string; date: string }): string => `${r.date}|${r.meet}`;

/** One fantasy matchup to re-score. `keys` = the scoring periods it covers ("m:date|meet" meet keys or "w:N" weeks). */
export type Contest = { label: string; keys: string[]; home: { id: string; name: string; ids: string[] }; away: { id: string; name: string; ids: string[] } | null };

type Scored = { athleteId: string; sourceId: string; week: number; points: number; code: string; meet: string; date: string };

function totalsBy(lines: Scored[], keyFn: (l: Scored) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(keyFn(l), round2((m.get(keyFn(l)) ?? 0) + l.points));
  return m;
}

function contestOutcomes(variants: Record<string, Scored[]>, contests: Contest[]): Record<string, unknown>[] {
  const per: Record<string, Map<string, number>> = {};
  for (const [k, ls] of Object.entries(variants)) {
    per[k] = totalsBy(ls, (l) => `${l.athleteId}|w:${l.week}`);
    for (const [kk, v] of totalsBy(ls, (l) => `${l.athleteId}|m:${meetKey(l)}`)) per[k].set(kk, v);
  }
  return contests.map((c) => {
    const row: Record<string, unknown> = { label: c.label, home: c.home.name, away: c.away?.name ?? "BYE" };
    for (const k of Object.keys(variants)) {
      const sum = (ids: string[]): number => round2(ids.reduce((t, id) => t + c.keys.reduce((tt, key) => tt + (per[k]?.get(`${id}|${key}`) ?? 0), 0), 0));
      const h = sum(c.home.ids);
      const a = c.away ? sum(c.away.ids) : null;
      row[k] = { home: h, away: a, winner: a === null ? c.home.name : h > a ? c.home.name : a > h ? c.away?.name ?? "" : "Tie" };
    }
    return row;
  });
}

// MARK: - Seeded vs unseeded scoring lab

export const SEED_FORMULAS = {
  current: {
    name: "Current rules (baseline)",
    math: "points = participation + overall place table + heat/flight place + top-% of field + time/mark tier + PB or SB (never both) + standards + records − DQ/DNF. Seed marks are not read.",
  },
  neutral: {
    name: "Performance-neutral",
    math: "points = participation + time/mark tier + PB or SB + standards + records − DQ/DNF. Place, heat place and top-% are removed, so the same mark always earns the same points whoever else was in the race.",
  },
  combined: {
    name: "One field (sections ranked together)",
    math: "When a meet splits an event into Seeded and Unseeded sections, overall place and top-% are computed against the WHOLE event (every section, every school) from the real marks. Same mark = same place, whichever section it was run in. Heat/flight place stays within the race. Everything else is unchanged.",
  },
  strength: {
    name: "One field + field-strength scaling",
    math: "One-field places as above, then place, heat-place and top-% points × (0.75 + 0.5 × field strength). Field strength (0–1) = mean table tier of the event's top-8 marks (all schools) ÷ the top tier, from the season's performance tables. Mark-based points are unchanged.",
  },
  beatSeed: {
    name: "Beat-your-seed (capped)",
    math: "current points + bonus, bonus = min(4, 1 pt per 1% better than reference). Reference = the published seed mark; unseeded athletes use their own verified season best before the meet; no reference = no bonus. Never paid when the same result already earned PB or SB points, so improvements are never double-counted. The cap is identical for seeded and unseeded athletes.",
  },
} as const;

export type SeedFormula = keyof typeof SEED_FORMULAS;
const PLACE_CODES = new Set(["place", "heat", "pct"]);
const BEAT_CAP = 4;

/** Runs every formula over the same real results. `fieldOf` returns the meet's complete-field profile for a result. */
export function seedLab(base: ScoringInput, contests: Contest[], nameOf: (id: string) => string, fieldOf: (r: Result) => FieldProfile | undefined): Record<string, unknown> {
  const lines = computeLines(base);
  const results = new Map(base.results.map((r) => [r.id, r]));
  const sc = (l: Line, points: number, code = l.code): Scored => ({ athleteId: l.athleteId, sourceId: l.sourceId, week: l.week, points, code, meet: l.meet, date: l.date });
  const current = lines.map((l) => sc(l, l.points));
  const neutral = lines.filter((l) => !PLACE_CODES.has(l.code)).map((l) => sc(l, l.points));

  // One field: sectioned events re-ranked against every section's real marks.
  const sectionStats = { sectioned: 0, reranked: 0, noFieldData: 0, seededSection: 0, unseededSection: 0 };
  const reranked = base.results.map((r) => {
    if (!r.section || r.relay || r.status !== "OK") return r;
    sectionStats.sectioned++;
    if (r.section === "seeded") sectionStats.seededSection++; else sectionStats.unseededSection++;
    const f = fieldOf(r);
    const v = measureForEvent(r.mark, r.event).m?.value;
    if (!f || v === undefined || f.marks.length === 0 || r.provisional) { sectionStats.noFieldData++; return r; }
    const kind = eventInfo(r.event).kind;
    const ahead = f.marks.filter((x) => (kind === "time" ? x < v - 1e-6 : x > v + 1e-6)).length;
    sectionStats.reranked++;
    return { ...r, place: ahead + 1, pctPlace: null, seeded: Math.max(f.size, f.marks.length) };
  });
  const combinedLines = computeLines({ ...base, results: reranked });
  const combined = combinedLines.map((l) => sc(l, l.points));
  let strengthKnown = 0; let strengthMissing = 0;
  const strength = combinedLines.map((l) => {
    if (!PLACE_CODES.has(l.code)) return sc(l, l.points);
    const fs = results.get(l.sourceId)?.fieldStrength;
    if (fs === null || fs === undefined) { strengthMissing++; return sc(l, l.points); }
    strengthKnown++;
    return sc(l, round2(l.points * (0.75 + 0.5 * fs)));
  });

  // Beat-your-seed: one bonus per individual result.
  const bestBefore = new Map<string, { date: string; v: number }[]>();
  for (const r of [...base.results].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.relay || r.status !== "OK") continue;
    const v = measureForEvent(r.mark, r.event).m?.value;
    if (v === undefined) continue;
    const k = `${r.athleteIds[0]}|${keyOf(eventInfo(r.event).name)}|${r.season ?? seasonOf(r.date, base.season)}`;
    bestBefore.set(k, [...(bestBefore.get(k) ?? []), { date: r.date, v }]);
  }
  const hasBest = new Set(lines.filter((l) => l.code === "best").map((l) => `${l.sourceId}|${l.athleteId}`));
  const bonus: Scored[] = [];
  const seedStats = { seeded: 0, unseededWithPrior: 0, unseededNoReference: 0, bonusesPaid: 0, blockedByPbSb: 0 };
  for (const r of base.results) {
    if (r.relay || r.status !== "OK" || r.historyOnly) continue;
    const info = eventInfo(r.event);
    if (info.kind === "points") continue;
    const aid = r.athleteIds[0];
    if (!aid) continue;
    const v = measureForEvent(r.mark, info.name).m?.value;
    if (v === undefined) continue;
    const seed = r.seedMark ? measureForEvent(r.seedMark, info.name).m?.value ?? null : null;
    let ref = seed;
    if (seed !== null) seedStats.seeded++;
    else {
      const prior = (bestBefore.get(`${aid}|${keyOf(info.name)}|${r.season ?? seasonOf(r.date, base.season)}`) ?? []).filter((x) => x.date < r.date).map((x) => x.v);
      ref = prior.length ? (info.kind === "time" ? Math.min(...prior) : Math.max(...prior)) : null;
      if (ref === null) { seedStats.unseededNoReference++; continue; }
      seedStats.unseededWithPrior++;
    }
    if (ref === null) continue;
    const imp = info.kind === "time" ? (ref - v) / ref : (v - ref) / ref;
    if (imp <= 0) continue;
    if (hasBest.has(`${r.id}|${aid}`)) { seedStats.blockedByPbSb++; continue; }
    const pts = Math.min(BEAT_CAP, Math.round(imp * 100 * 2) / 2);
    if (pts <= 0) continue;
    seedStats.bonusesPaid++;
    bonus.push({ athleteId: aid, sourceId: r.id, week: r.week, points: pts, code: "seed", meet: r.meet, date: r.date });
  }
  const beatSeed = [...current, ...bonus];
  const variants: Record<SeedFormula, Scored[]> = { current, neutral, combined, strength, beatSeed };

  // Fairness: within one meet+event, an unseeded athlete scoring MORE than a seeded athlete with the same or better mark.
  const isSeeded = (r: Result): boolean => r.section === "seeded" || (!r.section && !!r.seedMark);
  const isUnseeded = (r: Result): boolean => r.section === "unseeded" || (!r.section && !r.seedMark);
  const fairness: Record<string, number> = {};
  const examples: Record<string, unknown>[] = [];
  const groups = new Map<string, Result[]>();
  for (const r of base.results) {
    if (r.relay || r.status !== "OK" || !r.athleteIds[0]) continue;
    const k = `${meetKey(r)}|${r.gender}|${keyOf(eventInfo(r.event).name)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [name, ls] of Object.entries(variants)) {
    const pts = totalsBy(ls, (l) => `${l.sourceId}|${l.athleteId}`);
    let bad = 0;
    for (const rs of groups.values()) {
      const kind = eventInfo(rs[0]?.event ?? "").kind;
      for (const u of rs.filter(isUnseeded)) for (const sd of rs.filter(isSeeded)) {
        const uv = measureForEvent(u.mark, u.event).m?.value; const sv = measureForEvent(sd.mark, sd.event).m?.value;
        if (uv === undefined || sv === undefined) continue;
        const seededAsGood = kind === "time" ? sv <= uv : sv >= uv;
        const up = pts.get(`${u.id}|${u.athleteIds[0]}`) ?? 0;
        const sp = pts.get(`${sd.id}|${sd.athleteIds[0]}`) ?? 0;
        if (seededAsGood && up > sp + 1e-9) {
          bad++;
          if (name === "current" && examples.length < 8) examples.push({ meet: u.meet, date: u.date, event: eventInfo(u.event).name, unseeded: { name: nameOf(u.athleteIds[0] ?? ""), mark: u.mark, place: u.place, points: up }, seeded: { name: nameOf(sd.athleteIds[0] ?? ""), mark: sd.mark, place: sd.place, points: sp } });
        }
      }
    }
    fairness[name] = bad;
  }

  // Per-athlete, per-meet totals for every formula.
  const athleteMeets = new Map<string, Record<string, number>>();
  for (const [name, ls] of Object.entries(variants)) {
    for (const [k, v] of totalsBy(ls, (l) => `${l.athleteId}|${meetKey(l)}`)) {
      const row = athleteMeets.get(k) ?? {};
      row[name] = v;
      athleteMeets.set(k, row);
    }
  }
  const seededBy = new Map<string, boolean>();
  for (const r of base.results) if (!r.relay && r.athleteIds[0]) {
    const k = `${r.athleteIds[0]}|${meetKey(r)}`;
    seededBy.set(k, (seededBy.get(k) ?? false) || isSeeded(r));
  }
  const rows = [...athleteMeets.entries()].map(([k, v]) => {
    const [aid, date, ...meet] = k.split("|");
    return { athleteId: aid, name: nameOf(aid ?? ""), date, meet: meet.join("|"), seeded: seededBy.get(k) ?? false, ...Object.fromEntries(Object.keys(variants).map((f) => [f, v[f] ?? 0])) };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b as Record<string, unknown>).current as number - ((a as Record<string, unknown>).current as number));

  const avg = (f: string, seeded: boolean): number => round2(mean(rows.filter((r) => r.seeded === seeded).map((r) => Number((r as Record<string, unknown>)[f] ?? 0))));
  const summary = Object.fromEntries(Object.keys(variants).map((f) => [f, {
    ...SEED_FORMULAS[f as SeedFormula], total: round2(variants[f as SeedFormula].reduce((t, l) => t + l.points, 0)),
    avgSeededMeet: avg(f, true), avgUnseededMeet: avg(f, false), fairnessViolations: fairness[f] ?? 0,
  }]));
  const outcomes = contestOutcomes(variants, contests);
  const flips = Object.fromEntries(Object.keys(variants).map((f) => [f, outcomes.filter((o) => (o[f] as { winner: string }).winner !== (o.current as { winner: string }).winner).length]));
  return {
    formulas: summary, seedStats, sectionStats, fairnessExamples: examples, strengthCoverage: { scaled: strengthKnown, noTable: strengthMissing },
    meets: [...new Set(base.results.map((r) => meetKey(r)))].sort().map((k) => {
      const rs = base.results.filter((r) => meetKey(r) === k);
      return { date: k.split("|")[0], meet: k.split("|").slice(1).join("|"), results: rs.length, seededSection: rs.filter((r) => r.section === "seeded").length, unseededSection: rs.filter((r) => r.section === "unseeded").length, seedMarks: rs.filter((r) => !!r.seedMark).length };
    }),
    athletes: rows.slice(0, 400), matchups: outcomes, matchupFlipsVsCurrent: flips,
    fairnessRule: "Fairness violation = in the same meet and event, an athlete from the Unseeded section (or with no seed mark) scored MORE than a Seeded-section athlete whose mark was the same or better.",
  };
}

// MARK: - Relay lab

export const RELAY_OPTIONS = {
  current: { name: "1. Keep the current system", math: "Each verified leg earns the full relay result: participation + relay place table. (This is the same as option 3.)" },
  divided: { name: "2. Divide among the relay", math: "Relay points ÷ legs that ran (4, or more if more legs are published). Unverified legs' shares are never given to anyone." },
  full: { name: "3. Full points to every verified leg", math: "Each verified leg earns the full relay participation + relay place points." },
} as const;

export function relayLab(base: ScoringInput, contests: Contest[], nameOf: (id: string) => string): Record<string, unknown> {
  const lines = computeLines(base);
  const results = new Map(base.results.map((r) => [r.id, r]));
  const sc = (l: Line, points: number): Scored => ({ athleteId: l.athleteId, sourceId: l.sourceId, week: l.week, points, code: l.code, meet: l.meet, date: l.date });
  const legsOf = (r: Result): number => Math.max(4, r.athleteIds.length);
  const current = lines.map((l) => sc(l, l.points));
  const divided = lines.map((l) => {
    const r = results.get(l.sourceId);
    return r?.relay ? sc(l, round2(l.points / legsOf(r))) : sc(l, l.points);
  });
  const variants = { current, divided, full: current };
  const relays = base.results.filter((r) => r.relay).sort((a, b) => b.date.localeCompare(a.date)).map((r) => {
    const ls = lines.filter((l) => l.sourceId === r.id);
    const each = round2(ls.filter((l) => l.athleteId === r.athleteIds[0]).reduce((t, l) => t + l.points, 0));
    return {
      meet: r.meet, date: r.date, event: eventInfo(r.event).name, gender: r.gender, place: r.place, status: r.status, mark: r.mark,
      legs: r.athleteIds.map((id) => nameOf(id)), verifiedLegs: r.athleteIds.length, divisor: legsOf(r),
      perLeg: { current: each, divided: round2(each / legsOf(r)), full: each },
      lines: ls.filter((l) => l.athleteId === r.athleteIds[0]).map((l) => ({ label: l.label, points: l.points })),
    };
  });
  const athleteTotals = new Map<string, Record<string, number>>();
  for (const [name, ls] of Object.entries(variants)) for (const [aid, v] of totalsBy(ls, (l) => l.athleteId)) {
    const row = athleteTotals.get(aid) ?? {};
    row[name] = v;
    athleteTotals.set(aid, row);
  }
  const relayAthletes = new Set(base.results.filter((r) => r.relay).flatMap((r) => r.athleteIds));
  const outcomes = contestOutcomes(variants, contests);
  return {
    options: RELAY_OPTIONS, relays: relays.slice(0, 120),
    athletes: [...athleteTotals.entries()].filter(([aid]) => relayAthletes.has(aid)).map(([aid, v]) => ({ athleteId: aid, name: nameOf(aid), current: v.current ?? 0, divided: v.divided ?? 0, full: v.full ?? 0 })).sort((a, b) => b.current - a.current),
    matchups: outcomes,
    matchupFlipsVsCurrent: { divided: outcomes.filter((o) => (o.divided as { winner: string }).winner !== (o.current as { winner: string }).winner).length, full: 0 },
    howItWorks: [
      "Placement: the relay's official place uses the relay place table (not the individual table). Heat place, top-% and time/mark tiers never apply to relays.",
      "Participation: each verified leg earns the participation points once per relay run.",
      "Records, PB and SB: never awarded for relays (relay marks don't belong to one athlete).",
      "Multiple relays: each relay a player runs is scored separately (e.g. 4x400 and 4x800 the same day).",
      "Duplicates: every relay result has one stable source identity; re-imports update it in place and can never score twice.",
      "Membership: legs come from the names AthleticLIVE publishes on that relay entry, matched to master players by verified source ID or exact name + school. If legs aren't published, the relay goes to the commissioner review queue and earns nothing until confirmed. Nobody is guessed onto a relay.",
    ],
  };
}

// MARK: - Back-test

type Err = { n: number; mae: number; rmse: number; bias: number; coverage: number };

function errStats(pairs: { p: number; a: number; sd: number }[]): Err {
  const n = pairs.length;
  if (n === 0) return { n: 0, mae: 0, rmse: 0, bias: 0, coverage: 0 };
  const e = pairs.map((x) => x.p - x.a);
  return {
    n, mae: round2(mean(e.map(Math.abs))), rmse: round2(Math.sqrt(mean(e.map((x) => x * x)))), bias: round2(mean(e)),
    coverage: round2(pairs.filter((x) => Math.abs(x.p - x.a) <= Math.max(1, x.sd)).length / n),
  };
}

/**
 * Replays past meets in date order. For each meet the model only sees results dated BEFORE that meet (no peeking),
 * projects every athlete who competed there, then compares with the points the engine actually awarded.
 */
export type BacktestOpts = {
  /** Strict no-peek: ignore marks-on-file (they may be newer than the meet); only results dated before the meet. */
  strict?: boolean;
  /** Also project every athlete with prior history (actual = 0 when they didn't compete), not only those who raced. */
  pool?: boolean;
  /** Only test these meets (meetKey "date|meet"); history still uses every earlier result. */
  only?: (key: string) => boolean;
};

export function backtest(base: ScoringInput, athletes: { id: string; gender: Gender }[], maxMeets = 12, opts: BacktestOpts = {}): Record<string, unknown> {
  const genderOf = new Map(athletes.map((a) => [a.id, a.gender]));
  const all = base.results.filter((r) => r.provisional !== true);
  const meets = [...new Set(all.map((r) => meetKey(r)))].sort();
  const poolPairs: { p: number; a: number; sd: number }[] = [];
  const states: Record<string, number> = {};
  const pairs: { p: number; a: number; sd: number; naive: number | null; conf: string | null }[] = [];
  const blind: { p: number; a: number; sd: number }[] = [];
  const perMeet: Record<string, unknown>[] = [];
  const h2h = { right: 0, total: 0 };
  const lastPts = new Map<string, number>();
  const tested = meets.slice(1).filter((k) => !opts.only || opts.only(k)).slice(-maxMeets);
  for (const mk of meets) {
    const rows = all.filter((r) => meetKey(r) === mk);
    const date = rows[0]?.date ?? "";
    const hist = all.filter((r) => r.date < date);
    const ids = [...new Set(rows.filter((r) => !r.relay).flatMap((r) => r.athleteIds.slice(0, 1)))].filter((id) => genderOf.has(id));
    // Actual points at this meet: real results scored after the real history, individual events only (projections skip relays).
    const actualRows = rows.filter((r) => !r.relay).map((r) => ({ ...r, week: 999, historyOnly: false }));
    const actualLines = computeLines({ ...base, results: [...hist.map((r) => ({ ...r, week: Math.min(r.week, 998) })), ...actualRows] }).filter((l) => l.week === 999);
    const actual = totalsBy(actualLines.map((l) => ({ athleteId: l.athleteId, sourceId: l.sourceId, week: l.week, points: l.points, code: l.code, meet: l.meet, date: l.date })), (l) => l.athleteId);
    if (tested.includes(mk) && hist.length > 0 && ids.length > 0) {
      const entries: Record<string, string[]> = {};
      for (const r of rows) if (!r.relay && r.athleteIds[0]) (entries[r.athleteIds[0]] ??= []).push(eventInfo(r.event).name);
      const histBase = { ...base, results: hist.map((r) => ({ ...r, week: Math.min(r.week, 998) })), ...(opts.strict ? { pbs: {} } : {}) };
      const season = rows[0]?.season;
      const run = (withEntries: boolean, who: string[] = ids): Record<string, Projection> => project({
        base: histBase, lines: [], athletes: who.map((id) => ({ id, gender: genderOf.get(id) as Gender })), week: 999, date,
        entries: withEntries ? entries : null, weekDone: false, completedEvents: new Set(), season,
      });
      const withE = run(true);
      const noE = run(false);
      if (opts.pool) {
        // Everyone with earlier individual results: a waiver-wire view where nobody's entries are known in advance.
        const prior = [...new Set(hist.filter((r) => !r.relay && r.status === "OK").flatMap((r) => r.athleteIds.slice(0, 1)))].filter((id) => genderOf.has(id));
        const pp = run(false, prior);
        for (const id of prior) {
          const pr = pp[id];
          if (!pr) continue;
          states[pr.state] = (states[pr.state] ?? 0) + 1;
          if (pr.available) poolPairs.push({ p: pr.projected, a: actual.get(id) ?? 0, sd: pr.sd });
        }
      }
      const mp: { p: number; a: number; sd: number }[] = [];
      for (const id of ids) {
        const pr = withE[id];
        if (!pr || !pr.available || pr.events.length === 0) continue;
        const a = actual.get(id) ?? 0;
        pairs.push({ p: pr.projected, a, sd: pr.sd, naive: lastPts.get(id) ?? null, conf: pr.confidence });
        mp.push({ p: pr.projected, a, sd: pr.sd });
        const nb = noE[id];
        if (nb && nb.available) blind.push({ p: nb.projected, a, sd: nb.sd });
      }
      // Head-to-head: every pair of athletes at the meet: did the higher projection score more?
      const scored = ids.filter((id) => withE[id]?.available).map((id) => ({ p: withE[id]?.projected ?? 0, a: actual.get(id) ?? 0 }));
      for (let i = 0; i < scored.length; i++) for (let j = i + 1; j < scored.length; j++) {
        const x = scored[i] as { p: number; a: number }; const y = scored[j] as { p: number; a: number };
        if (Math.abs(x.p - y.p) < 0.01 || Math.abs(x.a - y.a) < 0.01) continue;
        h2h.total++;
        if ((x.p > y.p) === (x.a > y.a)) h2h.right++;
      }
      const st = errStats(mp);
      perMeet.push({ date, meet: mk.split("|").slice(1).join("|"), athletes: st.n, mae: st.mae, bias: st.bias, projected: round2(mp.reduce((t, x) => t + x.p, 0)), actual: round2(mp.reduce((t, x) => t + x.a, 0)) });
    }
    for (const id of ids) lastPts.set(id, actual.get(id) ?? 0);
  }
  const naivePairs = pairs.filter((x) => x.naive !== null).map((x) => ({ p: x.naive as number, a: x.a, sd: 0 }));
  const byConf = Object.fromEntries(["High", "Medium", "Low"].map((c) => [c, errStats(pairs.filter((x) => x.conf === c))]));
  const overall = errStats(pairs);
  return {
    meetsTested: perMeet.length, samples: overall.n, strict: opts.strict === true,
    withEntries: overall, withoutEntries: errStats(blind), naiveLastMeet: errStats(naivePairs), byConfidence: byConf,
    ...(opts.pool ? { pool: { ...errStats(poolPairs), states } } : {}),
    headToHead: { correct: h2h.right, total: h2h.total, accuracy: h2h.total ? round2(h2h.right / h2h.total) : null },
    perMeet,
    notes: [
      "Each meet is projected using only results dated before it (no peeking). Points are the real engine's points under the current rules.",
      "withEntries = the athlete's events at that meet were known in advance (as with published entries); withoutEntries = events had to be guessed from history.",
      "naiveLastMeet = 'they'll score what they scored last meet' baseline, for comparison.",
      "coverage = share of actual scores within the projected ± spread.",
      "headToHead = for every pair of athletes at the same meet, how often the one projected higher actually scored more.",
      ...(opts.strict ? ["STRICT: marks on file (PBs) were ignored because they may be newer than the meet; only results dated before each meet were used.", "withEntries is OPTIMISTIC: it uses the events each athlete actually contested as a stand-in for published entries."] : []),
      ...(opts.pool ? ["pool = every athlete with earlier results projected without entries (as on the waiver wire); actual = 0 when they didn't compete."] : []),
    ],
  };
}

// MARK: - Schedule

export type Game = { id: string; week: number; homeId: string; awayId: string | null; final: boolean; kind: string; round: string | null };

/** Circle-method rounds (bye = null) for a given team order. */
export function circleRounds(ids: string[]): [string | null, string | null][][] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: [string | null, string | null][][] = [];
  const rot = [...list];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string | null, string | null][] = [];
    for (let i = 0; i < n / 2; i++) pairs.push(r % 2 === 0 ? [rot[i] ?? null, rot[n - 1 - i] ?? null] : [rot[n - 1 - i] ?? null, rot[i] ?? null]);
    rounds.push(pairs);
    const last = rot.pop() ?? null;
    rot.splice(1, 0, last);
  }
  return rounds;
}

/** Deterministic shuffle (seeded) so a regenerate gives the same schedule for the same seed. */
function seeded<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`);

/** Validates a regular season: one game (or bye) per team per week, no self-games, balanced opponents and byes. */
export function checkSchedule(games: Game[], teamIds: string[], regularWeeks: number): { ok: boolean; problems: string[]; checks: { name: string; ok: boolean; detail: string }[]; opponents: Record<string, Record<string, number>>; byes: Record<string, number> } {
  const problems: string[] = [];
  const reg = games.filter((g) => g.kind === "regular");
  const opp: Record<string, Record<string, number>> = Object.fromEntries(teamIds.map((t) => [t, {}]));
  const byes: Record<string, number> = Object.fromEntries(teamIds.map((t) => [t, 0]));
  let missing = 0; let dup = 0; let self = 0; let unknown = 0;
  for (let w = 1; w <= regularWeeks; w++) {
    const wk = reg.filter((g) => g.week === w);
    const seen = new Map<string, number>();
    for (const g of wk) {
      if (g.homeId === g.awayId) self++;
      for (const t of [g.homeId, g.awayId]) if (t) { seen.set(t, (seen.get(t) ?? 0) + 1); if (!teamIds.includes(t)) unknown++; }
      if (g.awayId) {
        opp[g.homeId] && (opp[g.homeId][g.awayId] = (opp[g.homeId][g.awayId] ?? 0) + 1);
        opp[g.awayId] && (opp[g.awayId][g.homeId] = (opp[g.awayId][g.homeId] ?? 0) + 1);
      } else if (byes[g.homeId] !== undefined) byes[g.homeId] = (byes[g.homeId] ?? 0) + 1;
    }
    for (const t of teamIds) {
      const c = seen.get(t) ?? 0;
      if (c === 0) { missing++; problems.push(`Week ${w}: ${t} has no game or bye.`); }
      if (c > 1) { dup++; problems.push(`Week ${w}: ${t} is scheduled ${c} times.`); }
    }
  }
  const counts = teamIds.flatMap((a) => teamIds.filter((b) => b > a).map((b) => opp[a]?.[b] ?? 0));
  const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
  const byeVals = Object.values(byes);
  const byeSpread = byeVals.length ? Math.max(...byeVals) - Math.min(...byeVals) : 0;
  const odd = teamIds.length % 2 === 1;
  const checks = [
    { name: "Every team plays (or has a bye) every regular week", ok: missing === 0, detail: missing === 0 ? `${regularWeeks} weeks × ${teamIds.length} teams` : `${missing} missing` },
    { name: "No duplicate games in a week", ok: dup === 0, detail: dup === 0 ? "None" : `${dup} duplicates` },
    { name: "No team plays itself / unknown teams", ok: self === 0 && unknown === 0, detail: self + unknown === 0 ? "None" : `${self} self, ${unknown} unknown` },
    { name: "Balanced opponent rotation", ok: spread <= 1, detail: `Each pair meets ${Math.min(...(counts.length ? counts : [0]))}–${Math.max(...(counts.length ? counts : [0]))} times` },
    { name: odd ? "Byes spread evenly (odd team count)" : "No byes needed (even team count)", ok: odd ? byeSpread <= 1 : byeVals.every((b) => b === 0), detail: odd ? `Byes per team: ${Math.min(...byeVals)}–${Math.max(...byeVals)}` : "Even number of teams" },
  ];
  return { ok: checks.every((c) => c.ok), problems: problems.slice(0, 40), checks, opponents: opp, byes };
}

/**
 * Regenerates only the open regular-season weeks (>= fromWeek). Locked weeks are copied unchanged. Picks the seeded
 * team order that best balances opponent counts across the WHOLE season (including the locked weeks).
 */
export function regenerate(games: Game[], teamIds: string[], regularWeeks: number, fromWeek: number, seed: number): Game[] {
  const locked = games.filter((g) => g.kind !== "regular" || g.week < fromWeek);
  const lockedReg = locked.filter((g) => g.kind === "regular");
  const evaluate = (fresh: Game[]): number => {
    const counts = new Map<string, number>();
    const byes = new Map<string, number>(teamIds.map((t) => [t, 0]));
    for (const g of [...lockedReg, ...fresh]) {
      if (g.awayId) counts.set(pairKey(g.homeId, g.awayId), (counts.get(pairKey(g.homeId, g.awayId)) ?? 0) + 1);
      else byes.set(g.homeId, (byes.get(g.homeId) ?? 0) + 1);
    }
    const vals = teamIds.flatMap((a) => teamIds.filter((b) => b > a).map((b) => counts.get(pairKey(a, b)) ?? 0));
    const bv = [...byes.values()];
    let backToBack = 0;
    const all = [...lockedReg, ...fresh];
    for (const g of fresh) {
      if (!g.awayId) continue;
      const k = pairKey(g.homeId, g.awayId);
      if (all.some((x) => x.week === g.week - 1 && x.awayId && pairKey(x.homeId, x.awayId) === k)) backToBack++;
    }
    const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    const byeSpread = bv.length ? Math.max(...bv) - Math.min(...bv) : 0;
    return Math.max(0, spread - 1) * 1000 + Math.max(0, byeSpread - 1) * 1000 + spread * 10 + byeSpread * 10 + backToBack;
  };
  let best: Game[] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 300 && bestScore > 0; attempt++) {
    // Greedy week-by-week: bye to the team with the fewest byes, then pair teams who've met least (seeded tie-breaks).
    const counts = new Map<string, number>();
    const byes = new Map<string, number>(teamIds.map((t) => [t, 0]));
    for (const g of lockedReg) {
      if (g.awayId) counts.set(pairKey(g.homeId, g.awayId), (counts.get(pairKey(g.homeId, g.awayId)) ?? 0) + 1);
      else byes.set(g.homeId, (byes.get(g.homeId) ?? 0) + 1);
    }
    const fresh: Game[] = [];
    let prev = lockedReg.filter((g) => g.week === fromWeek - 1);
    for (let w = fromWeek; w <= regularWeeks; w++) {
      let pool = seeded([...teamIds].sort(), seed * 7919 + attempt * 104729 + w);
      const week: Game[] = [];
      if (pool.length % 2 === 1) {
        const bye = [...pool].sort((a, b) => (byes.get(a) ?? 0) - (byes.get(b) ?? 0))[0] as string;
        pool = pool.filter((t) => t !== bye);
        byes.set(bye, (byes.get(bye) ?? 0) + 1);
        week.push({ id: `${w}-${bye}`, week: w, homeId: bye, awayId: null, final: false, kind: "regular", round: null });
      }
      while (pool.length > 1) {
        const a = pool.shift() as string;
        const met = (b: string): number => (counts.get(pairKey(a, b)) ?? 0) * 10 + (prev.some((g) => g.awayId && pairKey(g.homeId, g.awayId) === pairKey(a, b)) ? 5 : 0);
        const b = [...pool].sort((x, y) => met(x) - met(y))[0] as string;
        pool = pool.filter((t) => t !== b);
        counts.set(pairKey(a, b), (counts.get(pairKey(a, b)) ?? 0) + 1);
        const home = (w + attempt) % 2 === 0 ? a : b;
        week.push({ id: `${w}-${home}`, week: w, homeId: home, awayId: home === a ? b : a, final: false, kind: "regular", round: null });
      }
      fresh.push(...week);
      prev = week;
    }
    const score = evaluate(fresh);
    if (score < bestScore) { bestScore = score; best = fresh; }
  }
  return [...locked, ...best].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
}
