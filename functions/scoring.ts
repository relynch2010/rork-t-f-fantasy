/**
 * TrackDraft scoring engine — the single source of truth for every fantasy point.
 *
 * Inputs are raw facts (results, school records, baton fumbles, standards, marks on file).
 * Output is an ordered list of scoring lines, each with a reason. Everything the app shows
 * (lineups, matchups, standings, breakdowns) is summed from these lines.
 *
 * Lines are always recomputed from scratch in chronological order, so corrected or
 * re-entered results replace their old points and nothing can be double-counted.
 */

export type Gender = "B" | "G";
export type EventKind = "time" | "field" | "points";
export type ResultStatus = "OK" | "DQ" | "DNF";
export type StandardType = "NB" | "NIKE" | "STATES";
export type BestOverride = "auto" | "PB" | "SB" | "none";

export type EventInfo = { name: string; kind: EventKind; relay: boolean };

export type Result = {
  id: string;
  key: string;
  week: number;
  meet: string;
  date: string;
  event: string;
  gender: Gender;
  athleteIds: string[];
  relay: boolean;
  mark: string;
  /** Overall place for individual events, relay place for relays. */
  place: number | null;
  heatPlace: number | null;
  seeded: number | null;
  status: ResultStatus;
  best: BestOverride;
  enteredAt: number;
  source: "form" | "import" | "live";
  /** Live results: meet record this came from. */
  meetId?: string | null;
  /** Live results still in progress: placement/percentile are withheld until the event is complete. */
  provisional?: boolean;
  /** Human summary shown with every line, e.g. "3rd overall · 6.81 · Heat 3". */
  detail?: string;
  /** Athlete isn't on a fantasy roster: the mark feeds PB/SB history but earns no fantasy points. */
  historyOnly?: boolean;
  /** Commissioner-corrected live result — later syncs never overwrite it. */
  locked?: boolean;
  /** Stable source identity (live results) used for duplicate protection. */
  sourceKey?: string;
  /** Place used for the percentile bonus when it differs from the placement place (e.g. prelim non-finalists). */
  pctPlace?: number | null;
  /** Same-day ordering independent of arrival: 0 = prelim, 1 = final/only round. */
  seq?: number;
  /** Explicit season (projections); otherwise the year of `date`. */
  season?: number;
  /** Heat (track) / flight (field) number. */
  heat?: number | null;
  /** Round (PRELIM / FINAL) as published. */
  round?: string | null;
  /** Source event id (live results). */
  eventId?: string | null;
  /** Seed mark published by the source (if any). */
  seedMark?: string | null;
  /**
   * Strength of this event's full field (every school) 0–1: mean table tier of the top-8 marks / the table's top tier.
   * Informational only (scoring labs, projections). The engine never reads it.
   */
  fieldStrength?: number | null;
  /** The source split this event into sections ("... Seeded" / "... Unseeded"); places were ranked within the section. */
  section?: "seeded" | "unseeded" | null;
  /** Previous official versions of this result (source corrections), newest last. */
  prev?: { at: number; mark: string; place: number | null; heatPlace: number | null; status: string; provisional: boolean }[];
};

export type SchoolRecord = {
  id: string;
  athleteId: string;
  school: string;
  event: string;
  date: string;
  mark: string;
  season: number;
  week: number;
  at: number;
};

export type Fumble = {
  id: string;
  athleteId: string;
  teamId: string | null;
  meet: string;
  event: string;
  date: string;
  week: number;
  at: number;
};

export type StandardRow = { nb: string; nike: string; states: string };

/** One configurable qualifying standard (ScoringStandard). Nothing is ever invented — the commissioner enters every row. */
export type Standard = RuleWindow & {
  id: string;
  season: number;
  gender: Gender;
  event: string;
  type: StandardType;
  mark: string;
  points: number;
  active: boolean;
};

export type MeasurementType = "TIME" | "DISTANCE" | "HEIGHT";

/**
 * One tier of a Fantasy T&F performance table (PerformanceScoringRule). These are league-configured fantasy
 * thresholds, never official standards; nothing is pre-filled. A tier is reached when the normalized mark is at or
 * faster than (TIME) / at or beyond (DISTANCE, HEIGHT) `value`. Adjacent tiers therefore form ranges:
 * minimumValue = this tier's threshold, maximumValue = the next better tier's threshold. Only the best reached tier scores.
 */
export type PerformanceRule = RuleWindow & {
  id: string;
  season: number;
  /** "X" applies to boys and girls. */
  gender: Gender | "X";
  event: string;
  measurement: MeasurementType;
  /** Threshold exactly as the commissioner typed it (e.g. "55.50", "40-06", "12.19m"). */
  mark: string;
  /** Normalized threshold: seconds for TIME, meters for DISTANCE/HEIGHT. */
  value: number;
  points: number;
  active: boolean;
  updatedAt: number;
  /** Effective window (fantasy weeks). A table edit never rewrites weeks that were already finished. */
  fromWeek?: number;
  toWeek?: number | null;
  /** Table version that created this row. */
  ver?: number;
};

export const STANDARD_LABEL: Record<StandardType, string> = { NB: "New Balance Nationals", NIKE: "Nike Nationals", STATES: "States Super" };
export const STANDARD_DEFAULT_POINTS: Record<StandardType, number> = { NB: 15, NIKE: 12, STATES: 20 };

export type Line = {
  id: string;
  athleteId: string;
  week: number;
  sourceId: string;
  meet: string;
  date: string;
  event: string;
  code: string;
  label: string;
  points: number;
  detail: string;
  provisional: boolean;
  meetId: string | null;
  /** Season (from the meet date) whose tables/standards scored this line. */
  season?: number;
  /** Exact evidence for this line (matched table + threshold, percentile math, etc.). */
  basis?: string;
  /** Configuration versions used: "scoring vN · tables vN". */
  ver?: string;
};

/** Every scoring category the engine knows. Codes match Line.code. */
export type CategoryCode = "part" | "place" | "heat" | "pct" | "perf" | "best" | "std" | "dq" | "sr" | "fumble";
export type AppliesTo = "individual" | "relay" | "track" | "field";
export const CATEGORIES: { code: CategoryCode; label: string }[] = [
  { code: "part", label: "Per-event participation" },
  { code: "place", label: "Overall / relay place" },
  { code: "heat", label: "Heat / flight place" },
  { code: "pct", label: "Seeded / unseeded percentile" },
  { code: "perf", label: "Time / mark tables" },
  { code: "best", label: "PB / SB (never stacked)" },
  { code: "std", label: "Standards (NB / Nike / States)" },
  { code: "dq", label: "DQ / DNF" },
  { code: "sr", label: "School record" },
  { code: "fumble", label: "Baton fumble" },
];
export const ALL_APPLIES: AppliesTo[] = ["individual", "relay", "track", "field"];

/**
 * Every point value the engine awards. Stored once, globally, in the Main League config (versioned, so a change only
 * applies to weeks that were still open when it was made). Defaults are the original TrackDraft rules.
 */
export type ScoringConfig = {
  participation: number;
  /** Individual overall placement points, 1st → 6th (any length). */
  overall: number[];
  /** Relay placement points, 1st → 6th. */
  relay: number[];
  /** Personal best points. */
  pb: number;
  /** Season best points. */
  sb: number;
  /** Fixed Fantasy T&F rule: PB and SB never stack. A PB (always also a season best) earns only the PB points. */
  bestMode: "single";
  /** Heat/flight placement points, 1st → 3rd. */
  heat: number[];
  percentile: { pct: number; pts: number }[];
  /**
   * Percentile brackets for athletes in an "Unseeded" section, ranked within that section. Missing (rule versions
   * saved before this existed) = the seeded brackets apply to everyone, exactly as those versions scored.
   */
  percentileUnseeded?: { pct: number; pts: number }[];
  /** Maximum standards points one athlete can earn in a season. Upgrades award only the difference. */
  standardCap: number;
  schoolRecord: number;
  fumble: number;
  dqdnf: number;
  /** Category on/off. Missing = on. */
  enabled: Record<string, boolean>;
  /** Which kinds of results a category applies to. Missing = all. */
  applies: Record<string, AppliesTo[]>;
};

/** A rule row's effective window. Global rows use timestamps (`since`/`until`); older league rows use week numbers. */
export type RuleWindow = { since?: number; until?: number | null; fromWeek?: number; toWeek?: number | null; scope?: "global" | "local" };

export type ScoringInput = {
  results: Result[];
  /** Point values for a given fantasy week. Defaults to DEFAULT_SCORING. */
  rulesFor?: (week: number) => ScoringConfig;
  /** Whether a standard / performance row applies to results in `week`. Defaults to the row's week window. */
  ruleActive?: (row: RuleWindow, week: number) => boolean;
  records: SchoolRecord[];
  fumbles: Fumble[];
  standards: Standard[];
  /** Fantasy T&F time/mark performance tables. Optional so older callers keep working. */
  performance?: PerformanceRule[];
  /** Results in weeks before this one keep the old rule (+2 for first in heat/flight only), so finished weeks never change. */
  legacyHeatBeforeWeek?: number;
  /** Fallback season when a result has no readable date. Tables/standards are picked by each result's own meet date. */
  season: number;
  /** Marks on file before the season. key: athleteId → eventKey → mark string */
  pbs: Record<string, Record<string, string>>;
  /** Configuration versions in force for a week (stamped on every line). */
  versionFor?: (week: number) => string;
};

/**
 * The season a result belongs to: the school year, named by the year it ends. Aug–Dec meets belong to the next
 * year's season, so a December 2026 indoor meet and a March 2027 meet are both season 2027 (same tables, one season
 * best, one standards cap). Before this, the calendar year split the indoor season on Jan 1 and December meets
 * found no tables.
 */
export function seasonOf(date: string, fallback: number): number {
  const y = Number((date ?? "").slice(0, 4));
  const m = Number((date ?? "").slice(5, 7));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return fallback;
  return Number.isInteger(m) && m >= 8 ? y + 1 : y;
}

export type HistoryEntry = { date: string; meet: string; mark: string; place: number | null; pb: boolean; sb: boolean };
export type EventHistory = { event: string; lifetimePb: string | null; seasonBest: string | null; results: HistoryEntry[] };
/** athleteId → event name → history */
export type History = Record<string, Record<string, EventHistory>>;

export const RULES = {
  participation: 2,
  overall: [10, 8, 6, 4, 2, 1],
  relay: [5, 4, 3, 2, 1, 0.5],
  best: 3,
  /** Heat (track) / flight (field) placement: 1st +3, 2nd +2, 3rd +1. Replaces the old +2 heat-win bonus. */
  heat: [3, 2, 1],
  /** Old rule, applied only to weeks that were already underway/finished before the new rule took effect. */
  legacyHeatWin: 2,
  percentile: [
    { pct: 0.05, pts: 20 },
    { pct: 0.1, pts: 15 },
    { pct: 0.2, pts: 12 },
    { pct: 0.3, pts: 9 },
    { pct: 0.4, pts: 6 },
  ],
  /** Maximum standards points one athlete can earn in a season. Upgrades award only the difference. */
  standardCap: 20,
  schoolRecord: 10,
  fumble: -5,
  dqdnf: -4,
};

export const DEFAULT_SCORING: ScoringConfig = {
  participation: RULES.participation, overall: [...RULES.overall], relay: [...RULES.relay], pb: RULES.best, sb: RULES.best, bestMode: "single",
  heat: [...RULES.heat], percentile: RULES.percentile.map((t) => ({ ...t })), standardCap: RULES.standardCap,
  schoolRecord: RULES.schoolRecord, fumble: RULES.fumble, dqdnf: RULES.dqdnf, enabled: {}, applies: {},
};

/** Is a category on, and does it apply to this kind of result? */
export function categoryApplies(R: ScoringConfig, code: string, relay: boolean, kind: EventKind): boolean {
  if (R.enabled?.[code] === false) return false;
  const a = R.applies?.[code];
  if (!a || a.length === 0) return true;
  const hasKind = a.includes("individual") || a.includes("relay");
  const hasSurface = a.includes("track") || a.includes("field");
  const okKind = !hasKind || a.includes(relay ? "relay" : "individual");
  const okSurface = !hasSurface || a.includes(kind === "field" ? "field" : "track");
  return okKind && okSurface;
}

const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : fallback;
};

/** Validates a (partial) scoring config against the defaults. Never throws; out-of-range values are clamped. */
export function cleanScoring(raw: unknown, base: ScoringConfig = DEFAULT_SCORING): ScoringConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (k: string, cur: number[], max: number): number[] => {
    const v = r[k];
    if (!Array.isArray(v)) return [...cur];
    return v.slice(0, max).map((x, i) => num(x, -50, 100, cur[i] ?? 0));
  };
  const tiers = (v: unknown): { pct: number; pts: number }[] => (v as unknown[]).slice(0, 8).map((t) => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    return { pct: num(o.pct, 0.01, 1, 0.1), pts: num(o.pts, 0, 100, 0) };
  }).sort((a, b) => a.pct - b.pct);
  const pct = Array.isArray(r.percentile) ? tiers(r.percentile) : base.percentile.map((t) => ({ ...t }));
  const pctU = Array.isArray(r.percentileUnseeded) ? tiers(r.percentileUnseeded) : base.percentileUnseeded?.map((t) => ({ ...t }));
  const codes = new Set<string>(CATEGORIES.map((c) => c.code));
  const enabled: Record<string, boolean> = { ...(base.enabled ?? {}) };
  if (r.enabled && typeof r.enabled === "object") {
    for (const [k, v] of Object.entries(r.enabled as Record<string, unknown>)) if (codes.has(k) && typeof v === "boolean") enabled[k] = v;
  }
  for (const k of Object.keys(enabled)) if (enabled[k] !== false) delete enabled[k];
  const applies: Record<string, AppliesTo[]> = {};
  for (const [k, v] of Object.entries(base.applies ?? {})) applies[k] = [...v];
  if (r.applies && typeof r.applies === "object") {
    for (const [k, v] of Object.entries(r.applies as Record<string, unknown>)) {
      if (!codes.has(k) || !Array.isArray(v)) continue;
      const list = ALL_APPLIES.filter((x) => (v as unknown[]).includes(x));
      if (list.length === 0 || list.length === ALL_APPLIES.length) delete applies[k];
      else applies[k] = list;
    }
  }
  return {
    enabled, applies,
    participation: num(r.participation, -20, 50, base.participation),
    overall: list("overall", base.overall, 12),
    relay: list("relay", base.relay, 12),
    pb: num(r.pb, -20, 50, base.pb),
    sb: num(r.sb, -20, 50, base.sb),
    bestMode: "single",
    heat: list("heat", base.heat, 8),
    percentile: pct,
    ...(pctU ? { percentileUnseeded: pctU } : {}),
    standardCap: num(r.standardCap, 0, 100, base.standardCap),
    schoolRecord: num(r.schoolRecord, -50, 100, base.schoolRecord),
    fumble: num(r.fumble, -50, 50, base.fumble),
    dqdnf: num(r.dqdnf, -50, 50, base.dqdnf),
  };
}

/** Default window check: week-numbered rows only. */
export function weekWindow(row: RuleWindow, week: number): boolean {
  return (row.fromWeek ?? 1) <= week && (row.toWeek === undefined || row.toWeek === null || week <= row.toWeek);
}

const CATALOG: EventInfo[] = [
  ...["55m", "60m", "100m", "200m", "300m", "400m", "500m", "600m", "800m", "1000m", "1500m", "1600m", "Mile", "3000m", "3200m", "2 Mile", "5000m"].map((name) => ({ name, kind: "time" as const, relay: false })),
  ...["55m Hurdles", "60m Hurdles", "100m Hurdles", "110m Hurdles", "300m Hurdles", "400m Hurdles", "2000m Steeplechase", "1500m Racewalk"].map((name) => ({ name, kind: "time" as const, relay: false })),
  ...["4x100 Relay", "4x200 Relay", "4x400 Relay", "4x800 Relay", "Sprint Medley Relay", "Distance Medley Relay", "Shuttle Hurdle Relay"].map((name) => ({ name, kind: "time" as const, relay: true })),
  ...["High Jump", "Pole Vault", "Long Jump", "Triple Jump", "Shot Put", "Discus", "Javelin", "Weight Throw", "Hammer"].map((name) => ({ name, kind: "field" as const, relay: false })),
  ...["Pentathlon", "Heptathlon", "Decathlon"].map((name) => ({ name, kind: "points" as const, relay: false })),
];

export const EVENT_NAMES: string[] = CATALOG.map((e) => e.name);

export function keyOf(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Looks an event up in the catalog; unknown names are classified by keywords. */
export function eventInfo(raw: string): EventInfo {
  const name = raw.trim();
  const k = keyOf(name);
  const hit = CATALOG.find((e) => keyOf(e.name) === k);
  if (hit) return hit;
  const lower = name.toLowerCase();
  const relay = /relay|4x|smr|dmr|medley/.test(lower);
  if (/athlon/.test(lower)) return { name, kind: "points", relay: false };
  const field = /jump|vault|put|shot|discus|javelin|weight|hammer|throw/.test(lower);
  return { name, kind: field ? "field" : "time", relay };
}

export type Measurement = {
  /** Seconds (time), meters (field) or points (multi-events). */
  value: number;
  unit: "s" | "m" | "pts";
  system: "time" | "imperial" | "metric" | "points";
  /** Field marks only: the same mark in feet (40'6.5" → 40.5417). */
  feet: number | null;
};

const M_PER_FT = 0.3048;

/** Strips wind readings, conversions in brackets and trailing flags (w, a, h, q, PR, SB, *). */
function cleanMarkText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]|''/g, '"')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(pr|pb|sb|nr|mr|q)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[*#]+$/, "")
    .replace(/(\d)\s*[wahq]$/, "$1")
    .trim();
}

/**
 * Normalizes a raw result string numerically. Never compares strings.
 * Times: "11.82", "55.42", "2:04.15", "1:02:03.4" → seconds.
 * Field: "40'0\"", "40-06.5", "19' 8.25\"", "40 ft 6 in", "40.5ft", "70in", "12.19m", "185cm", "12.19" (bare = meters) → meters (+ feet).
 * Returns null when the text can't be read reliably (e.g. inches ≥ 12, seconds ≥ 60, stray text).
 */
export function measure(raw: string, kind: EventKind): Measurement | null {
  const text = cleanMarkText(raw);
  if (!text) return null;
  if (kind === "time") {
    const t = text.replace(/\s*(s|sec|secs)$/, "");
    if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(t)) return null;
    const parts = t.split(":").map(Number);
    if (parts.some((p, i) => !Number.isFinite(p) || (i > 0 && p >= 60))) return null;
    let total = 0;
    for (const p of parts) total = total * 60 + p;
    return total > 0 ? { value: total, unit: "s", system: "time", feet: null } : null;
  }
  if (kind === "points") {
    const t = text.replace(/\s*(pts|points)$/, "");
    if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return n > 0 ? { value: n, unit: "pts", system: "points", feet: null } : null;
  }
  const imperial = (feet: number, inches: number): Measurement | null => {
    if (!Number.isFinite(feet) || !Number.isFinite(inches) || inches >= 12 || inches < 0) return null;
    const totalFeet = feet + inches / 12;
    return totalFeet > 0 ? { value: totalFeet * M_PER_FT, unit: "m", system: "imperial", feet: totalFeet } : null;
  };
  const fi = text.match(/^(\d+)\s*(?:'|ft|feet|-)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inches)?$/);
  if (fi) return imperial(Number(fi[1]), Number(fi[2] ?? 0));
  const decFeet = text.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)$/);
  if (decFeet) {
    const f = Number(decFeet[1]);
    return f > 0 ? { value: f * M_PER_FT, unit: "m", system: "imperial", feet: f } : null;
  }
  const inchesOnly = text.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inches)$/);
  if (inchesOnly) {
    const inches = Number(inchesOnly[1]);
    return inches > 0 ? { value: inches * 0.0254, unit: "m", system: "imperial", feet: inches / 12 } : null;
  }
  const cm = text.match(/^(\d+(?:\.\d+)?)\s*cm$/);
  if (cm) {
    const m = Number(cm[1]) / 100;
    return m > 0 ? { value: m, unit: "m", system: "metric", feet: m / M_PER_FT } : null;
  }
  const meters = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|meters|metres)?$/);
  if (meters) {
    const m = Number(meters[1]);
    return m > 0 ? { value: m, unit: "m", system: "metric", feet: m / M_PER_FT } : null;
  }
  return null;
}

/**
 * Times → seconds, field marks → meters, multi-event scores → points. Returns null if unreadable.
 * Strict normalization first; the original lenient reader is kept as a fallback so marks that already
 * scored (PB/SB/standards) keep exactly the value they had before.
 */
export function parseMark(raw: string, kind: EventKind): number | null {
  return measure(raw, kind)?.value ?? legacyParseMark(raw, kind);
}

function legacyParseMark(raw: string, kind: EventKind): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (kind === "time") {
    const clean = text.replace(/[^0-9:.]/g, "");
    if (!clean) return null;
    const parts = clean.split(":").map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return null;
    let total = 0;
    for (const p of parts) total = total * 60 + p;
    return total > 0 ? total : null;
  }
  if (kind === "points") {
    const n = Number(text.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const feetInches = text.match(/^(\d+)\s*(?:-|'|ft|\s)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/);
  if (feetInches && (text.includes("-") || text.includes("'") || text.includes("ft"))) {
    const feet = Number(feetInches[1]);
    const inches = Number(feetInches[2] ?? 0);
    const meters = (feet * 12 + inches) * 0.0254;
    return meters > 0 ? meters : null;
  }
  const n = Number(text.replace(/m$/, "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Plausible normalized ranges (seconds / meters) per event. Outside this range a mark is treated as malformed, not guessed. */
const PLAUSIBLE: Record<string, [number, number]> = {
  "55m": [5, 15], "60m": [5.5, 16], "100m": [9, 25], "200m": [19, 50], "300m": [30, 80], "400m": [43, 120], "500m": [58, 160],
  "600m": [70, 200], "800m": [100, 330], "1000m": [130, 420], "1500m": [200, 600], "1600m": [220, 640], "Mile": [220, 650],
  "3000m": [440, 1300], "3200m": [470, 1400], "2 Mile": [470, 1400], "5000m": [760, 2200],
  "55m Hurdles": [6.5, 16], "60m Hurdles": [7, 17], "100m Hurdles": [12, 30], "110m Hurdles": [12.5, 30], "300m Hurdles": [34, 90],
  "400m Hurdles": [46, 120], "2000m Steeplechase": [300, 900], "1500m Racewalk": [300, 1200],
  "High Jump": [0.8, 2.6], "Pole Vault": [1.2, 6.5], "Long Jump": [2, 9.5], "Triple Jump": [5, 19], "Shot Put": [3, 25],
  "Discus": [8, 80], "Javelin": [8, 100], "Weight Throw": [5, 30], "Hammer": [8, 90],
};

/** Events that can carry a Fantasy T&F performance table (individual timed and field events). */
export const PERFORMANCE_EVENTS: string[] = CATALOG.filter((e) => !e.relay && e.kind !== "points").map((e) => e.name);

export function measurementTypeOf(event: string): MeasurementType | null {
  const info = eventInfo(event);
  if (info.relay || info.kind === "points") return null;
  if (info.kind === "time") return "TIME";
  return /high jump|pole vault/i.test(info.name) ? "HEIGHT" : "DISTANCE";
}

/** Reads a mark for a specific event and rejects values outside that event's plausible range. */
export function measureForEvent(raw: string, event: string): { m: Measurement | null; issue: string | null } {
  const info = eventInfo(event);
  if (!raw.trim()) return { m: null, issue: "missing time/mark" };
  const m = measure(raw, info.kind);
  if (!m) return { m: null, issue: `couldn't read "${raw.trim()}"` };
  const range = PLAUSIBLE[info.name];
  if (range && (m.value < range[0] || m.value > range[1])) return { m: null, issue: `"${raw.trim()}" is outside the normal range for ${info.name}` };
  return { m, issue: null };
}

function better(a: number, b: number, kind: EventKind): boolean {
  return kind === "time" ? a < b - 1e-9 : a > b + 1e-9;
}

function meets(a: number, standard: number, kind: EventKind): boolean {
  return kind === "time" ? a <= standard + 1e-9 : a >= standard - 1e-9;
}

/** Table thresholds are stored to 1e-6; real marks never differ by less than 0.01 s or 1 mm, so allow 1e-5. */
function reachesTier(a: number, threshold: number, kind: EventKind): boolean {
  return kind === "time" ? a <= threshold + 1e-5 : a >= threshold - 1e-5;
}

/** How a mark was normalized (original → number + unit + method). */
export function describeMark(raw: string, event: string): { original: string; value: number | null; unit: string; method: string } {
  const info = eventInfo(event);
  const { m, issue } = measureForEvent(raw, info.name);
  if (!m) return { original: raw, value: null, unit: "", method: issue ?? "unreadable" };
  const method = m.system === "time" ? (raw.includes(":") ? "minutes:seconds → seconds" : "seconds")
    : m.system === "imperial" ? `feet-inches → ${m.feet?.toFixed(4)} ft × 0.3048 → meters`
    : m.system === "metric" ? "meters" : "points";
  return { original: raw, value: Math.round(m.value * 1e6) / 1e6, unit: m.unit, method };
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const fmtPts = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Converts legacy per-event rows (NB/Nike/States columns) into standard records. */
export function standardsFromRows(rows: Record<string, StandardRow>, season: number): Standard[] {
  const out: Standard[] = [];
  for (const [k, row] of Object.entries(rows)) {
    const [g, ek] = k.split("|");
    const gender: Gender = g === "G" ? "G" : "B";
    const event = EVENT_NAMES.find((n) => keyOf(n) === ek) ?? ek ?? "";
    const add = (type: StandardType, mark: string): void => {
      if (mark.trim()) out.push({ id: `${gender}-${ek}-${type}-${season}`, season, gender, event, type, mark: mark.trim(), points: STANDARD_DEFAULT_POINTS[type], active: true });
    };
    add("NB", row.nb);
    add("NIKE", row.nike);
    add("STATES", row.states);
  }
  return out;
}

/** Runs every rule over the full history. Deterministic: same input → same lines. */
export function computeLines(input: ScoringInput): Line[] {
  return computeAll(input).lines;
}

/** Scoring lines plus the PB / season-best history those lines were judged against. */
export function computeAll(input: ScoringInput): { lines: Line[]; history: History } {
  const lines: Line[] = [];
  const history: History = {};
  const best = new Map<string, number>();
  const bestMark = new Map<string, string>();
  const seasonBest = new Map<string, number>();
  const seasonMark = new Map<string, string>();
  const stdAwarded = new Map<string, number>();

  const hist = (athleteId: string, event: string): EventHistory => {
    const byEvent = (history[athleteId] ??= {});
    return (byEvent[event] ??= { event, lifetimePb: null, seasonBest: null, results: [] });
  };

  for (const [athleteId, events] of Object.entries(input.pbs)) {
    for (const [eventKey, mark] of Object.entries(events)) {
      const info = eventInfo(eventKey);
      const v = parseMark(mark, info.kind);
      if (v === null) continue;
      best.set(`${athleteId}|${keyOf(eventKey)}`, v);
      bestMark.set(`${athleteId}|${keyOf(eventKey)}`, mark);
      hist(athleteId, info.name).lifetimePb = mark;
    }
  }

  const rulesFor = input.rulesFor ?? ((): ScoringConfig => DEFAULT_SCORING);
  const active = input.ruleActive ?? weekWindow;
  const verFor = input.versionFor ?? ((): string => "");
  const standardValues = (gender: Gender, info: EventInfo, week: number, season: number): { label: string; pts: number; value: number; mark: string }[] => {
    const out: { label: string; pts: number; value: number; mark: string }[] = [];
    const cap = rulesFor(week).standardCap;
    for (const s of input.standards) {
      if (!s.active || s.season !== season || s.gender !== gender || keyOf(s.event) !== keyOf(info.name) || !active(s, week)) continue;
      const v = parseMark(s.mark, info.kind);
      if (v !== null) out.push({ label: STANDARD_LABEL[s.type], pts: Math.min(cap, Math.max(0, s.points)), value: v, mark: s.mark });
    }
    return out;
  };

  // Deterministic order, independent of arrival: date → round (prelims first) → stable source identity.
  // Hand-entered results keep their entry order among themselves.
  const tie = (a: Result, b: Result): number => {
    if (a.source === "live" && b.source === "live") return (a.seq ?? 1) - (b.seq ?? 1) || (a.sourceKey ?? a.id).localeCompare(b.sourceKey ?? b.id);
    if (a.source === "live" && b.source !== "live") return -1;
    if (a.source !== "live" && b.source === "live") return 1;
    return a.enteredAt - b.enteredAt || a.id.localeCompare(b.id);
  };
  const sorted = [...input.results].sort((a, b) => a.date.localeCompare(b.date) || tie(a, b));

  for (const r of sorted) {
    const info = eventInfo(r.event);
    const eventKey = keyOf(info.name);
    const R = rulesFor(r.week);
    const season = r.season ?? seasonOf(r.date, input.season);
    const ver = verFor(r.week);
    const on = (code: string): boolean => categoryApplies(R, code, r.relay, info.kind);
    // PB/SB/standards keep their original reader so already-scored weeks never change; performance tiers use strict normalization.
    const readMark = (): number | null => parseMark(r.mark, info.kind);
    const push = (athleteId: string, code: string, label: string, points: number, basis = ""): void => {
      lines.push({
        id: `${r.id}:${code}:${athleteId}`,
        athleteId, week: r.week, sourceId: r.id, meet: r.meet, date: r.date, event: info.name, code, label, points,
        detail: r.detail ?? "", provisional: r.provisional === true, meetId: r.meetId ?? null, season, basis, ver,
      });
    };

    for (const aid of r.athleteIds) {
      if (r.historyOnly) {
        const v = r.status === "OK" && !r.relay ? readMark() : null;
        if (v === null) continue;
        const k = `${aid}|${eventKey}`;
        const sk = `${k}|${season}`;
        const pb = best.get(k);
        const sbv = seasonBest.get(sk);
        const isPb = pb !== undefined && better(v, pb, info.kind);
        const isSb = !isPb && sbv !== undefined && better(v, sbv, info.kind);
        if (pb === undefined || better(v, pb, info.kind)) { best.set(k, v); bestMark.set(k, r.mark); }
        if (sbv === undefined || better(v, sbv, info.kind)) { seasonBest.set(sk, v); seasonMark.set(k, r.mark); }
        const h = hist(aid, info.name);
        h.lifetimePb = bestMark.get(k) ?? h.lifetimePb;
        h.seasonBest = seasonMark.get(k) ?? h.seasonBest;
        h.results.push({ date: r.date, meet: r.meet, mark: r.mark, place: r.place, pb: isPb, sb: isSb });
        continue;
      }
      if (on("part")) push(aid, "part", "Event participation", R.participation, "Competed in this event");
      if (r.status !== "OK") {
        if (on("dq")) push(aid, "dq", r.status === "DQ" ? "Disqualified (DQ)" : "Did not finish (DNF)", R.dqdnf, `Official status ${r.status}`);
        continue;
      }

      if (r.place !== null && r.place >= 1 && on("place")) {
        const table = r.relay ? R.relay : R.overall;
        const pts = table[r.place - 1];
        if (pts !== undefined && pts !== 0) push(aid, "place", r.relay ? `${ordinal(r.place)} relay place` : `${ordinal(r.place)} overall`, pts, `Official overall place ${r.place}${r.seeded ? ` of ${r.seeded}` : ""} (${r.relay ? "relay" : "individual"} place table)`);
      }

      // Heat (track) / flight (field) placement — separate from overall placement.
      if (on("heat") && r.heatPlace !== null && r.heatPlace >= 1 && r.week < (input.legacyHeatBeforeWeek ?? 0)) {
        if (r.heatPlace === 1) push(aid, "heat", info.kind === "field" ? "First in flight" : "First in heat", RULES.legacyHeatWin, "Legacy rule (week finished before the heat-place rule)");
      } else if (on("heat") && r.heatPlace !== null && r.heatPlace >= 1) {
        const hp = R.heat[r.heatPlace - 1];
        if (hp !== undefined && hp !== 0) push(aid, "heat", `${ordinal(r.heatPlace)} in ${info.kind === "field" ? "flight" : "heat"}`, hp, `Official ${info.kind === "field" ? "flight" : "heat"} place ${r.heatPlace} (separate from overall place)`);
      }

      const pp = r.pctPlace ?? r.place;
      if (on("pct") && pp !== null && pp >= 1 && r.seeded !== null && r.seeded > 0 && pp <= r.seeded) {
        const ratio = pp / r.seeded;
        // Unseeded section: its own brackets (ranked within the section) once the rule version defines them.
        const unseeded = r.section === "unseeded" && Array.isArray(R.percentileUnseeded);
        const brackets = unseeded ? (R.percentileUnseeded ?? []) : R.percentile;
        const tier = [...brackets].sort((a, b) => a.pct - b.pct).find((t) => ratio <= t.pct + 1e-9);
        if (tier && tier.pts !== 0) {
          push(aid, "pct", `Top ${Math.round(tier.pct * 100)}% of ${r.seeded} ${unseeded ? "unseeded" : "seeded"}`, tier.pts,
            `${unseeded ? "Unseeded section · " : ""}Field size ${r.seeded} · valid competitors ${r.seeded} · place ${pp} · ${pp}/${r.seeded} = ${(ratio * 100).toFixed(2)}% · bracket top ${Math.round(tier.pct * 100)}%`);
        }
      }

      const value = readMark();

      // Fantasy T&F time/mark tier (individual events only, highest reached tier only), from the meet season's table.
      if (on("perf") && !r.relay && info.kind !== "points" && input.performance && input.performance.length > 0) {
        const checked = measureForEvent(r.mark, info.name);
        if (checked.m) {
          const v = checked.m.value;
          const reached = input.performance.filter((p) =>
            p.active && p.season === season && (p.gender === "X" || p.gender === r.gender) && keyOf(p.event) === eventKey && p.points > 0 &&
            active(p, r.week) && reachesTier(v, p.value, info.kind),
          );
          const top = reached.sort((a, b) => b.points - a.points || (info.kind === "time" ? a.value - b.value : b.value - a.value))[0];
          if (top) {
            const d = describeMark(r.mark, info.name);
            const dir = info.kind === "time" ? "or faster" : top.measurement === "HEIGHT" ? "or higher" : "or farther";
            push(aid, "perf", `${info.kind === "time" ? "Time" : "Mark"} tier: ${top.mark} or better`, top.points,
              `Performance ${r.mark} (= ${d.value ?? "?"} ${d.unit}, ${d.method}) · ${season} ${r.gender === "G" ? "Girls" : "Boys"} ${info.name} table · matched tier "${top.mark} ${dir}" (= ${top.value} ${d.unit}) → ${top.points}`);
          }
        }
      }

      const k = `${aid}|${eventKey}`;
      // Season bests are per season (from the meet date): a 2025 mark never makes a 2026 season best.
      const sk = `${k}|${season}`;
      let isPb = false;
      let isSb = false;
      if (r.best === "PB") isPb = true;
      else if (r.best === "SB") isSb = true;
      else if (r.best === "auto" && value !== null && !r.relay) {
        const prevBest = best.get(k);
        const prevSeason = seasonBest.get(sk);
        if (prevBest !== undefined && better(value, prevBest, info.kind)) isPb = true;
        else if (prevSeason !== undefined && better(value, prevSeason, info.kind)) isSb = true;
      }
      // PB and SB never stack: a PB is also a season best but earns only the PB points.
      if (on("best")) {
        const why = r.best === "PB" || r.best === "SB" ? "from the source's published pre-meet PR/SR (strictly better)" : "from verified performance history (strictly better)";
        if (isPb) push(aid, "best", "Personal best", R.pb, `PB ${why}; PB and SB never stack`);
        else if (isSb) push(aid, "best", "Season best", R.sb, `SB ${why}; PB and SB never stack`);
      }
      if (value !== null && !r.relay) {
        const prevBest = best.get(k);
        if (prevBest === undefined || better(value, prevBest, info.kind)) { best.set(k, value); bestMark.set(k, r.mark); }
        const prevSeason = seasonBest.get(sk);
        if (prevSeason === undefined || better(value, prevSeason, info.kind)) { seasonBest.set(sk, value); seasonMark.set(k, r.mark); }
        const h = hist(aid, info.name);
        h.lifetimePb = bestMark.get(k) ?? h.lifetimePb;
        h.seasonBest = seasonMark.get(k) ?? h.seasonBest;
        h.results.push({ date: r.date, meet: r.meet, mark: r.mark, place: r.place, pb: isPb, sb: isSb });
      }

      if (value !== null && on("std")) {
        const met = standardValues(r.gender, info, r.week, season).filter((s) => meets(value, s.value, info.kind));
        const top = met.sort((a, b) => b.pts - a.pts)[0];
        const sk = `${aid}|${season}`;
        const already = stdAwarded.get(sk) ?? 0;
        if (top && top.pts > already) {
          const diff = top.pts - already;
          push(aid, "std", already === 0 ? `${top.label} standard` : `Upgraded to ${top.label} standard (+${fmtPts(diff)} difference)`, diff,
            `${r.mark} meets the ${season} ${top.label} standard ${top.mark}; season highest ${top.pts}${already ? `, ${already} already earned` : ""}`);
          stdAwarded.set(sk, top.pts);
        }
      }
    }
  }

  const seenRecords = new Set<string>();
  for (const rec of [...input.records].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)) {
    const info = eventInfo(rec.event);
    const k = `${rec.athleteId}|${keyOf(info.name)}|${rec.season}`;
    if (seenRecords.has(k)) continue;
    seenRecords.add(k);
    if (rulesFor(rec.week).enabled?.sr === false) continue;
    lines.push({
      id: `${rec.id}:sr:${rec.athleteId}`,
      athleteId: rec.athleteId, week: rec.week, sourceId: rec.id, meet: rec.school || "School record", date: rec.date,
      event: info.name, code: "sr", label: `School record${rec.mark ? ` (${rec.mark})` : ""}`, points: rulesFor(rec.week).schoolRecord,
      detail: "Confirmed by commissioner", provisional: false, meetId: null,
    });
  }

  const seenFumbles = new Set<string>();
  for (const f of input.fumbles) {
    const k = `${f.athleteId}|${keyOf(f.meet)}|${f.date}|${keyOf(f.event)}`;
    if (seenFumbles.has(k)) continue;
    seenFumbles.add(k);
    if (rulesFor(f.week).enabled?.fumble === false) continue;
    lines.push({
      id: `${f.id}:fumble:${f.athleteId}`,
      athleteId: f.athleteId, week: f.week, sourceId: f.id, meet: f.meet, date: f.date,
      event: eventInfo(f.event).name, code: "fumble", label: "Baton fumble", points: rulesFor(f.week).fumble,
      detail: "Confirmed by commissioner", provisional: false, meetId: null,
    });
  }

  return { lines, history };
}

/** ScoringEvent category for a line code. */
export function categoryOf(line: Line): string {
  switch (line.code) {
    case "part": return "EVENT_PARTICIPATION";
    case "place": return line.label.includes("relay") ? "RELAY_PLACEMENT" : "PLACEMENT";
    case "heat": return "HEAT_PLACEMENT";
    case "perf": return line.label.startsWith("Time") ? "TIME_PERFORMANCE" : "MARK_PERFORMANCE";
    case "pct": return "PERCENTILE";
    case "best": return line.label.startsWith("Personal") ? "PERSONAL_BEST" : "SEASON_BEST";
    case "sbx": return "SEASON_BEST";
    case "std": return "STANDARD";
    case "sr": return "SCHOOL_RECORD";
    case "fumble": return "BATON_FUMBLE";
    case "dq": return line.label.includes("DQ") ? "DQ" : "DNF";
    default: return line.code.toUpperCase();
  }
}

/** Stable identity used to replace a re-entered result instead of adding it twice. */
export function resultKey(meet: string, date: string, event: string, athleteIds: string[], relay: boolean, gender: Gender): string {
  const base = `${keyOf(meet)}|${date}|${keyOf(eventInfo(event).name)}`;
  return relay ? `${base}|relay|${gender}` : `${base}|${athleteIds[0] ?? ""}`;
}
