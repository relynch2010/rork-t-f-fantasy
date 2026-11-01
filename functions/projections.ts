/**
 * Player projections and matchup win probability.
 *
 * Pipeline (never a separate points formula):
 *   real stored results → projected participation (which events) → projected time/mark (+ historical place)
 *   → hypothetical Results → the EXISTING scoring engine (computeLines) → projected scoring lines → expected points.
 *
 * Deterministic: same inputs → same output. Versioned by MODEL_VERSION. Projections never enter real scoring;
 * callers only read the returned numbers. Actual points always replace (never stack on) a projected event.
 */
import { categoryApplies, computeLines, DEFAULT_SCORING, eventInfo, keyOf, measureForEvent, seasonOf, weekWindow, type Gender, type Line, type Result, type ScoringInput } from "./scoring";

export const MODEL_VERSION = "proj-1.4";

/**
 * Why a projection shows the number it does. Screens show the matching label instead of a bare 0.00.
 *   projected    — expected points still to come this week
 *   actual       — the athlete already has real points this week and nothing is left to project
 *   finished     — every meet/event of the week is over and they scored nothing (a real 0, not a projection)
 *   notEntered   — the week's meet published entries and the athlete isn't on them
 *   noMeet       — no meet is scheduled for this week
 *   insufficient — no usable history (no verified marks or PB to project from)
 */
export type ProjState = "projected" | "actual" | "finished" | "notEntered" | "noMeet" | "insufficient";

export const STATE_LABEL: Record<ProjState, string> = {
  projected: "Projected", actual: "Actual points", finished: "Week finished", notEntered: "Not entered", noMeet: "No meet this week", insufficient: "Not enough data",
};

/** z for a strong (90th percentile) day. */
const UPSIDE_Z = 1.28;

/** Half-life (days) of a mark's weight: recent marks count most, older verified marks still count. */
const HALF_LIFE_DAYS = 60;
const MAX_MARKS = 10;
/** Marks from the year before the target meet are preferred ("last season"); older ones only when there are none. */
const WINDOW_DAYS = 365;

export type Confidence = "High" | "Medium" | "Low";

export type ProjEvent = {
  event: string;
  /** Projected time/mark (display), null for actual-only rows. */
  mark: string | null;
  /** Chance the athlete enters this event this week (0–1). */
  probability: number;
  /** Expected points counted for this event (actual points once it has a result). */
  points: number;
  /** Engine points if the athlete competes at the projected mark. */
  ifCompetes: number;
  sd: number;
  status: "projected" | "live" | "actual" | "done" | "noMeet";
  actual: number | null;
  /** No active performance table for this event: no time/mark points are projected (or awarded). */
  tableMissing: boolean;
  samples: number;
  /** Projected scoring categories (engine lines for the projected performance). */
  basis?: { label: string; points: number }[];
  /** Real performances the projection was built from (newest first). */
  sources?: { date: string; meet: string; mark: string }[];
  /** Plain-language assumptions behind this projected event. */
  assumptions?: string[];
};

export type Projection = {
  athleteId: string;
  available: boolean;
  confidence: Confidence | null;
  /** Expected points still to come (projected, not yet resulted). */
  projected: number;
  /** Real points already scored this week (from the live/official engine). */
  actual: number;
  /** actual + projected remaining. */
  total: number;
  sd: number;
  recentAvg: number | null;
  events: ProjEvent[];
  note: string;
  /** Why the number is what it is (never a bare 0.00 on screen). */
  state: ProjState;
  stateLabel: string;
  /** Remaining projected points on a strong day (projected + 1.28·sd), never mixed with actual points. */
  upside: number;
  /** No meet is scheduled yet (preseason / off-season): projected for a typical meet. */
  estimate?: boolean;
};

export type ProjInput = {
  base: ScoringInput;
  /** Real engine lines (for actuals, per-result point history and recent averages). */
  lines: Line[];
  athletes: { id: string; gender: Gender }[];
  week: number;
  /** Target meet date (YYYY-MM-DD) — history is only what happened before this week. */
  date: string;
  /** athleteId → catalog events entered this week, when the meet published entries. null = no entry data. */
  entries: Record<string, string[]> | null;
  /** Every meet of the week is final: nothing remains to project. */
  weekDone: boolean;
  /** "gender|event" events already finished this week (athletes without a result there get 0 for it). */
  completedEvents: Set<string>;
  /** Season whose tables score the hypothetical performances (defaults to the target date's year). */
  season?: number;
  /**
   * "gender|event" → this week's meet field (every school), from entries/seed marks or results. When present the
   * projected place and field size come from THIS meet's real field instead of the athlete's historical median.
   */
  fields?: Record<string, { size: number; strength: number | null; marks: number[]; fromSeeds: boolean }>;
  /** No meet is scheduled this week: nothing is projected (state noMeet). */
  noMeet?: boolean;
  /** No meet is scheduled this week or later (preseason / off-season): project a typical meet on `date`. */
  estimate?: boolean;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

function fmtMark(value: number, kind: "time" | "field" | "points"): string {
  if (kind === "time") return value.toFixed(2);
  return value.toFixed(2);
}

function displayMark(value: number, kind: "time" | "field" | "points"): string {
  if (kind !== "time") return `${value.toFixed(2)}m`;
  if (value < 60) return value.toFixed(2);
  const m = Math.floor(value / 60);
  return `${m}:${(value - m * 60).toFixed(2).padStart(5, "0")}`;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.abs(tb - ta) / 86_400_000 : 9999;
}

type Plan = {
  aid: string;
  gender: Gender;
  event: string;
  p: number;
  value: number;
  kind: "time" | "field" | "points";
  samples: number;
  lastDate: string | null;
  result: Result;
  sources: { date: string; meet: string; mark: string }[];
  assumptions: string[];
};

/** Does a performance table cover this event for this athlete's gender, season and week? */
export function hasTable(base: ScoringInput, event: string, gender: Gender, week: number, date = ""): boolean {
  const k = keyOf(eventInfo(event).name);
  const active = base.ruleActive ?? weekWindow;
  const season = seasonOf(date, base.season);
  return (base.performance ?? []).some((p) =>
    p.active && p.season === season && (p.gender === "X" || p.gender === gender) && keyOf(p.event) === k && active(p, week));
}

/** Projects every requested athlete for one week. */
export function project(input: ProjInput): Record<string, Projection> {
  const { base, week } = input;
  // History = what had happened BEFORE the target meet: strictly earlier dates, or the same day in an earlier week.
  // A later-dated result never feeds an earlier week (e.g. a postponed meet), and the week's own results never feed
  // its own projection (they show as actual points instead).
  const before = (r: Result): boolean => (r.week !== week || r.historyOnly === true) && (r.date < input.date || (r.date === input.date && r.week < week && r.historyOnly !== true));
  const plans: Plan[] = [];
  const out: Record<string, Projection> = {};

  // Per-result fantasy points from real engine lines (for spread estimates and recent averages).
  const pointsBySource = new Map<string, number>();
  const weekly = new Map<string, Map<number, number>>();
  for (const l of input.lines) {
    pointsBySource.set(`${l.sourceId}|${l.athleteId}`, (pointsBySource.get(`${l.sourceId}|${l.athleteId}`) ?? 0) + l.points);
    const w = weekly.get(l.athleteId) ?? new Map<number, number>();
    w.set(l.week, (w.get(l.week) ?? 0) + l.points);
    weekly.set(l.athleteId, w);
  }

  // How often verified marks improve: lifetime PB / season best rates per athlete-event, shrunk toward the pool's rate.
  // A projected mark is an average, so the engine never sees it as a PB; this adds the EXPECTED PB/SB points instead.
  const improve = new Map<string, { n: number; pb: number; sb: number }>();
  {
    const seq = new Map<string, { date: string; v: number; season: number; kind: string }[]>();
    for (const r of base.results) {
      if (r.relay || r.status !== "OK" || r.provisional === true || !before(r) || !r.athleteIds[0]) continue;
      const info = eventInfo(r.event);
      if (info.kind === "points") continue;
      const v = measureForEvent(r.mark, info.name).m?.value;
      if (v === undefined) continue;
      const k = `${r.athleteIds[0]}|${info.name}`;
      seq.set(k, [...(seq.get(k) ?? []), { date: r.date, v, season: r.season ?? seasonOf(r.date, base.season), kind: info.kind }]);
    }
    for (const [k, xs] of seq) {
      xs.sort((x, y) => x.date.localeCompare(y.date));
      const c = { n: 0, pb: 0, sb: 0 };
      for (let i = 1; i < xs.length; i++) {
        const cur = xs[i] as { v: number; season: number; kind: string };
        const better = (x: number, y: number): boolean => (cur.kind === "time" ? x < y - 1e-9 : x > y + 1e-9);
        const prev = xs.slice(0, i);
        const best = prev.reduce((b, x) => (better(x.v, b) ? x.v : b), (prev[0] as { v: number }).v);
        const seasonPrev = prev.filter((x) => x.season === cur.season);
        const sbest = seasonPrev.length ? seasonPrev.reduce((b, x) => (better(x.v, b) ? x.v : b), (seasonPrev[0] as { v: number }).v) : null;
        c.n++;
        if (better(cur.v, best)) c.pb++;
        else if (sbest !== null && better(cur.v, sbest)) c.sb++;
      }
      improve.set(k, c);
    }
  }
  const pool = [...improve.values()].reduce((t, c) => ({ n: t.n + c.n, pb: t.pb + c.pb, sb: t.sb + c.sb }), { n: 0, pb: 0, sb: 0 });
  const poolPb = pool.n > 0 ? pool.pb / pool.n : 0.3;
  const poolSb = pool.n > 0 ? pool.sb / pool.n : 0.1;
  const rules = base.rulesFor?.(week) ?? DEFAULT_SCORING;

  const spread = new Map<string, number[]>();
  /** Events left out because the chance of entering was below 20% (or entries were published without them). */
  const skipped = new Map<string, number>();
  for (const a of input.athletes) {
    const hist = base.results
      .filter((r) => r.athleteIds.includes(a.id) && !r.relay && before(r) && r.provisional !== true)
      .sort((x, y) => y.date.localeCompare(x.date) || y.enteredAt - x.enteredAt);
    const meetsSeen = [...new Set(hist.map((r) => `${keyOf(r.meet)}|${r.date}`))];
    const recentMeets = new Set(meetsSeen.slice(0, 6));
    const byEvent = new Map<string, Result[]>();
    for (const r of hist) {
      const name = eventInfo(r.event).name;
      byEvent.set(name, [...(byEvent.get(name) ?? []), r]);
    }
    const entered = input.entries?.[a.id];
    const candidates = new Set<string>([...byEvent.keys(), ...(entered ?? []), ...Object.keys(base.pbs[a.id] ?? {}).map((e) => eventInfo(e).name)]);
    for (const ev of candidates) {
      const info = eventInfo(ev);
      if (info.relay || info.kind === "points") continue;
      const rs = byEvent.get(ev) ?? [];
      // Participation: meet entries are strong evidence; otherwise how often recent meets included this event.
      let p: number;
      const assumptions: string[] = [];
      if (entered) { p = entered.includes(ev) ? 1 : 0; assumptions.push("Entered in this event at this week's meet (published entries)."); }
      else if (recentMeets.size > 0) {
        const n = new Set(rs.filter((r) => recentMeets.has(`${keyOf(r.meet)}|${r.date}`)).map((r) => `${keyOf(r.meet)}|${r.date}`)).size;
        p = n / recentMeets.size;
        assumptions.push(`Competed in this event at ${n} of their last ${recentMeets.size} meets → ${Math.round(p * 100)}% chance of entering.`);
      } else { p = rs.length > 0 || base.pbs[a.id] ? 0.5 : 0; assumptions.push("No recent meets on file: 50% chance of entering (PB on file)."); }
      if (p < 0.2) { skipped.set(a.id, (skipped.get(a.id) ?? 0) + 1); continue; }
      // Mark: time-decayed mean of the last ten readable marks (half-life 60 days); PB on file is the fallback.
      const readable = rs.filter((r) => r.status === "OK").map((r) => ({ r, m: measureForEvent(r.mark, ev).m })).filter((x) => x.m !== null);
      const windowed = readable.filter((x) => daysBetween(x.r.date, input.date) <= WINDOW_DAYS);
      const marks = (windowed.length > 0 ? windowed : readable).slice(0, MAX_MARKS);
      if (windowed.length === 0 && readable.length > 0) assumptions.push("No marks in the last 12 months: older verified marks are used.");
      let value: number | null = null;
      if (marks.length > 0) {
        let wsum = 0;
        let vsum = 0;
        marks.forEach((x, i) => { const w = 0.5 ** (daysBetween(x.r.date, input.date) / HALF_LIFE_DAYS) * 0.9 ** i; wsum += w; vsum += w * (x.m?.value ?? 0); });
        value = vsum / wsum;
      } else {
        const pbRaw = Object.entries(base.pbs[a.id] ?? {}).find(([k]) => keyOf(k) === keyOf(ev))?.[1];
        const m = pbRaw ? measureForEvent(pbRaw, ev).m : null;
        if (m) value = m.value;
      }
      if (value === null) continue;
      assumptions.push(marks.length > 0 ? `Projected mark = recency-weighted average of their last ${marks.length} verified mark${marks.length === 1 ? "" : "s"} (recent meets count most; half-life ${HALF_LIFE_DAYS} days).` : "Projected mark = personal best on file (no verified results yet).");
      const recent = rs.slice(0, 6);
      let place = median(recent.map((r) => r.place).filter((x): x is number => x !== null && x > 0));
      const heat = median(recent.map((r) => r.heatPlace).filter((x): x is number => x !== null && x > 0));
      let seeded = median(recent.map((r) => r.seeded).filter((x): x is number => x !== null && x > 0));
      const field = input.fields?.[`${a.gender}|${ev}`];
      if (field && field.marks.length >= 3) {
        // This meet's real field: place = 1 + entrants with a better mark than the projection (own seed excluded once).
        const own = rs[0]?.seedMark ? measureForEvent(rs[0].seedMark, ev).m?.value ?? null : null;
        const pv: number = value;
        let ahead = field.marks.filter((v) => (info.kind === "time" ? v < pv - 1e-6 : v > pv + 1e-6)).length;
        if (own !== null && (info.kind === "time" ? own < pv : own > pv)) ahead = Math.max(0, ahead - 1);
        place = ahead + 1;
        seeded = Math.max(field.size, field.marks.length);
        assumptions.push(`Place ${ahead + 1} of ${seeded} from this meet's entered field (${field.fromSeeds ? "seed marks" : "posted marks"}, every school)${field.strength !== null ? `; field strength ${Math.round(field.strength * 100)}%` : ""}.`);
      } else {
        assumptions.push(place !== null ? `Place = median of recent places (${Math.round(place)})${seeded !== null ? ` in a field of ${Math.round(seeded)}` : ""} (this meet's field isn't published yet).` : "No place history: no placement or percentile points projected.");
      }
      const id = `proj:${a.id}:${keyOf(ev)}`;
      plans.push({
        aid: a.id, gender: a.gender, event: ev, p, value, kind: info.kind, samples: marks.length, lastDate: rs[0]?.date ?? null,
        sources: marks.map((x) => ({ date: x.r.date, meet: x.r.meet, mark: x.r.mark })), assumptions,
        result: {
          season: input.season ?? seasonOf(input.date, base.season),
          id, key: id, week, meet: "Projection", date: "9999-12-31", event: ev, gender: a.gender, athleteIds: [a.id], relay: false,
          mark: fmtMark(value, info.kind), place: place !== null ? Math.round(place) : null, heatPlace: heat !== null ? Math.round(heat) : null,
          seeded: seeded !== null ? Math.round(seeded) : null, status: "OK", best: "auto", enteredAt: 0, source: "form",
        },
      });
      spread.set(`${a.id}|${ev}`, rs.map((r) => pointsBySource.get(`${r.id}|${a.id}`)).filter((x): x is number => x !== undefined));
    }
  }

  // One run of the real scoring engine over real history + the hypothetical performances (sorted last).
  const projLines = plans.length > 0 ? computeLines({ ...base, results: [...base.results, ...plans.map((p) => p.result)] }) : [];
  const projPts = new Map<string, number>();
  const projBasis = new Map<string, { label: string; points: number }[]>();
  for (const l of projLines) {
    if (!l.sourceId.startsWith("proj:")) continue;
    // PB/SB for a projected (average) mark is replaced by the expected PB/SB points added below.
    if (l.code === "best") continue;
    projPts.set(l.sourceId, (projPts.get(l.sourceId) ?? 0) + l.points);
    projBasis.set(l.sourceId, [...(projBasis.get(l.sourceId) ?? []), { label: l.label, points: l.points }]);
  }

  // Actual points this week, per athlete and event.
  const actualBy = new Map<string, Map<string, { pts: number; live: boolean }>>();
  for (const l of input.lines) {
    if (l.week !== week) continue;
    const m = actualBy.get(l.athleteId) ?? new Map<string, { pts: number; live: boolean }>();
    const cur = m.get(l.event) ?? { pts: 0, live: false };
    cur.pts += l.points;
    cur.live = cur.live || l.provisional;
    m.set(l.event, cur);
    actualBy.set(l.athleteId, m);
  }

  for (const a of input.athletes) {
    const mine = plans.filter((p) => p.aid === a.id);
    const acts = actualBy.get(a.id) ?? new Map<string, { pts: number; live: boolean }>();
    const events: ProjEvent[] = [];
    let projected = 0;
    let actual = 0;
    let variance = 0;
    for (const p of mine) {
      let pts = round2(projPts.get(p.result.id) ?? 0);
      if (categoryApplies(rules, "best", false, p.kind)) {
        const c = improve.get(`${a.id}|${p.event}`) ?? { n: 0, pb: 0, sb: 0 };
        const K = 3;
        const pPb = (c.pb + K * poolPb) / (c.n + K);
        const pSb = (c.sb + K * poolSb) / (c.n + K);
        const exp = round2(pPb * rules.pb + pSb * rules.sb);
        if (exp > 0) {
          pts = round2(pts + exp);
          projBasis.set(p.result.id, [...(projBasis.get(p.result.id) ?? []), { label: `Expected PB/SB (${Math.round(pPb * 100)}% PB, ${Math.round(pSb * 100)}% SB chance)`, points: exp }]);
          p.assumptions.push(`PB/SB chance from how often their verified marks improved (${c.pb + c.sb} of ${c.n}), blended with the pool rate.`);
        }
      }
      const hist = spread.get(`${a.id}|${p.event}`) ?? [];
      // Spread calibrated on the back-test: points per event swing a lot meet to meet.
      const sdPts = Math.max(hist.length >= 2 ? std(hist) : 0, 0.45 * pts + 2.5);
      const act = acts.get(p.event);
      const tableMissing = !hasTable(base, p.event, a.gender, week, input.date);
      const extra = { basis: projBasis.get(p.result.id) ?? [], sources: p.sources, assumptions: [...p.assumptions, ...(tableMissing ? ["No time/mark table for this event: no time/mark points projected."] : [])] };
      if (act) {
        // Actual replaces projection for this event (never added on top).
        acts.delete(p.event);
        actual += act.pts;
        if (act.live) variance += (0.25 * sdPts) ** 2;
        events.push({ event: p.event, mark: displayMark(p.value, p.kind), probability: 1, points: round2(act.pts), ifCompetes: pts, sd: act.live ? round2(0.25 * sdPts) : 0, status: act.live ? "live" : "actual", actual: round2(act.pts), tableMissing, samples: p.samples, ...extra });
        continue;
      }
      const finished = input.weekDone || input.noMeet === true || input.completedEvents.has(`${a.gender}|${p.event}`);
      if (finished) {
        events.push({ event: p.event, mark: displayMark(p.value, p.kind), probability: p.p, points: 0, ifCompetes: pts, sd: 0, status: input.noMeet && !input.weekDone ? "noMeet" : "done", actual: null, tableMissing, samples: p.samples, ...extra });
        continue;
      }
      const expected = p.p * pts;
      projected += expected;
      variance += p.p * sdPts ** 2 + p.p * (1 - p.p) * pts ** 2;
      events.push({ event: p.event, mark: displayMark(p.value, p.kind), probability: round2(p.p), points: round2(expected), ifCompetes: pts, sd: round2(Math.sqrt(p.p * sdPts ** 2 + p.p * (1 - p.p) * pts ** 2)), status: "projected", actual: null, tableMissing, samples: p.samples, ...extra });
    }
    for (const [event, act] of acts) {
      actual += act.pts;
      if (act.live) variance += (0.2 * Math.abs(act.pts)) ** 2;
      events.push({ event, mark: null, probability: 1, points: round2(act.pts), ifCompetes: round2(act.pts), sd: 0, status: act.live ? "live" : "actual", actual: round2(act.pts), tableMissing: false, samples: 0 });
    }
    const top = [...mine].sort((x, y) => y.p - x.p || y.samples - x.samples)[0];
    let confidence: Confidence | null = null;
    if (top) {
      const fresh = top.lastDate !== null && daysBetween(top.lastDate, input.date) <= 60;
      confidence = top.samples >= 4 && fresh ? "High" : top.samples >= 2 ? "Medium" : "Low";
    }
    const pastWeeks = [...(weekly.get(a.id) ?? new Map<number, number>()).entries()].filter(([w]) => w < week).sort((x, y) => y[0] - x[0]).slice(0, 3);
    const available = mine.length > 0 || events.length > 0;
    const hasActual = events.some((e) => e.status === "actual" || e.status === "live");
    const remainingSd = Math.sqrt(Math.max(0, variance));
    let state: ProjState;
    if (input.noMeet && !input.estimate && !input.weekDone && !hasActual) state = "noMeet";
    else if (projected > 0.0001) state = "projected";
    else if (hasActual) state = "actual";
    else if (input.weekDone || mine.some((p) => input.completedEvents.has(`${a.gender}|${p.event}`))) state = "finished";
    else if (input.entries && (skipped.get(a.id) ?? 0) > 0) state = "notEntered";
    else state = "insufficient";
    out[a.id] = {
      ...(input.estimate ? { estimate: true } : {}),
      state, stateLabel: input.estimate && state === "projected" ? "Estimate: typical meet (no meet scheduled yet)" : STATE_LABEL[state], upside: round2(projected + (projected > 0 ? UPSIDE_Z * remainingSd : 0)),
      athleteId: a.id, available, confidence: mine.length > 0 ? confidence : null,
      projected: round2(projected), actual: round2(actual), total: round2(projected + actual), sd: round2(Math.sqrt(variance)),
      recentAvg: pastWeeks.length > 0 ? round2(pastWeeks.reduce((s, [, v]) => s + v, 0) / pastWeeks.length) : null,
      events,
      note: state === "notEntered" ? "Not on this week's published entries."
        : state === "noMeet" ? "No meet scheduled this week."
        : input.estimate && state === "projected" ? "No meet is scheduled yet: expected points at a typical meet, from last season's results and PBs."
        : state === "finished" ? "This week is over: actual points only."
        : state === "insufficient" ? ((skipped.get(a.id) ?? 0) > 0 ? "Competes too rarely in recent meets to project (under a 20% chance of entering any event)." : "Projection unavailable: no verified results or PB on file.")
        : mine.length === 0 ? (input.weekDone ? "This week is over: actual points only." : "Actual points so far; no remaining events to project.") : "",
    };
  }
  return out;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Win chance for each side (percent, one decimal, always summing to 100). Accounts for uncertainty: the gap is
 * divided by the combined spread of what's still to come. Never 0/100 while the matchup isn't final. null when final.
 */
export function winProbability(home: { total: number; sd: number }, away: { total: number; sd: number }, final: boolean): { home: number; away: number } | null {
  if (final) return null;
  const sd = Math.sqrt(home.sd ** 2 + away.sd ** 2);
  const gap = home.total - away.total;
  let p = sd < 1e-6 ? (gap > 0 ? 1 : gap < 0 ? 0 : 0.5) : phi(gap / sd);
  p = Math.min(0.99, Math.max(0.01, p));
  const h = Math.round(p * 1000) / 10;
  return { home: h, away: Math.round((100 - h) * 10) / 10 };
}
