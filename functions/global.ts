/**
 * Global Fantasy T&F configuration, owned by the Main League (invite code T7RAN2) and stored once in the Directory.
 *
 * Leagues never keep their own copy of these rules: each league reads the current config (cached briefly, pushed on
 * every change) and feeds it into the one scoring engine. League data (teams, rosters, lineups, results, matchups,
 * standings, history) always stays inside each league.
 */
import {
  cleanScoring, DEFAULT_SCORING, eventInfo, keyOf, measureForEvent, measurementTypeOf, PERFORMANCE_EVENTS, STANDARD_DEFAULT_POINTS,
  type Gender, type PerformanceRule, type ScoringConfig, type Standard, type StandardType,
} from "./scoring";
import { emptyStats, type Meet } from "./meets";
import type { Pos } from "./seed";

/** The one fixed Main League. Never derived from name, date, order, device, user or local storage. */
export const MAIN_LEAGUE_CODE = "T7RAN2";

export class GlobalError extends Error {}

export type GameSettings = {
  pickSeconds: number;
  regularWeeks: number;
  playoffTeams: number;
  consolation: boolean;
  tiebreaker: "pf" | "h2h";
  waiverType: "rolling" | "faab";
  /** "weekly" = one Yahoo-style run per week on `waiverDay` at `waiverHour` (US Eastern). "daily" = legacy N-day waivers. */
  waiverSchedule: "weekly" | "daily";
  /** Day of the weekly waiver run, 0 = Sunday … 3 = Wednesday … 6 = Saturday. */
  waiverDay: number;
  waiverDays: number;
  waiverHour: number;
  tzOffsetMin: number;
  faabBudget: number;
  maxAddsPerWeek: number;
  tradeReview: "none" | "commish" | "league";
  tradeReviewDays: number;
  vetoVotes: number;
  tradeDeadlineWeek: number;
  lineupLock: "results" | "manual";
};

/** Roster & position rules. The spot layout (SPR, DIS, FLD, FLEX, 2 bench, IR) is fixed. */
export type RosterRules = {
  /** Whether the IR spot can be used at all. */
  irSlot: boolean;
  /** Player statuses allowed in the IR spot. */
  irStatuses: ("IR" | "O" | "Q")[];
  /** Positions that can fill the FLEX spot. */
  flexPositions: Pos[];
};

export type LiveRules = { pollSeconds: number; autoFinalMinutes: number; maxLiveHours: number };

export type NoticeCategory = "player" | "trades" | "waivers" | "draft" | "live" | "league";
export type NoticeRules = Record<NoticeCategory, boolean>;

export type GlobalAudit = { at: number; actorId: string; actorName: string; action: string; detail: string };

export type GlobalConfig = {
  version: number;
  /** Bumps whenever anything that changes points changes (rules, standards, tables). */
  scoringVersion: number;
  mainLeagueId: string;
  mainLeagueCode: string;
  /** Who may change global config. Reported by the Main League itself; never taken from a client. */
  mainCommissionerId: string;
  initializedAt: number;
  updatedAt: number;
  updatedBy: string;
  /** Point values over time. The entry in force when a week was finalized scores that week. `version` = scoring version it created. */
  rules: { since: number; rules: ScoringConfig; version?: number; by?: string }[];
  /** Bumps on every performance-table change. Each table row records the version that created it (`ver`). */
  tableVersion: number;
  /** Every table version: who, when, what. */
  tableLog?: { at: number; version: number; by: string; detail: string }[];
  standards: Standard[];
  performance: PerformanceRule[];
  settings: GameSettings;
  roster: RosterRules;
  live: LiveRules;
  notices: NoticeRules;
  /** Global meet records (every field from the Add Meet screen). */
  meets: Meet[];
  audit: GlobalAudit[];
};

export const DEFAULT_SETTINGS: GameSettings = {
  pickSeconds: 90, regularWeeks: 8, playoffTeams: 4, consolation: false, tiebreaker: "pf",
  waiverType: "rolling", waiverSchedule: "weekly", waiverDay: 3, waiverDays: 2, waiverHour: 3, tzOffsetMin: -240, faabBudget: 100, maxAddsPerWeek: 0,
  tradeReview: "commish", tradeReviewDays: 1, vetoVotes: 3, tradeDeadlineWeek: 0, lineupLock: "results",
};
export const DEFAULT_ROSTER: RosterRules = { irSlot: true, irStatuses: ["IR", "O"], flexPositions: ["SPR", "DIS", "FLD"] };
export const DEFAULT_LIVE: LiveRules = { pollSeconds: 15, autoFinalMinutes: 30, maxLiveHours: 16 };
export const DEFAULT_NOTICES: NoticeRules = { player: true, trades: true, waivers: true, draft: true, live: true, league: true };

export const GLOBAL_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[];
/** Season-shape settings: a league that already drafted keeps its own values until its next draft. */
export const SHAPE_KEYS = ["regularWeeks", "playoffTeams", "consolation"] as const;
/** Per-league settings (not global): draft date/time, draft order, league size. */
export const LOCAL_SETTING_KEYS = ["maxTeams", "draftAt", "draftOrderMode"] as const;

/** Fields of a meet that are global. Everything else on a league's meet object is that league's own derived data. */
export const GLOBAL_MEET_KEYS = [
  "id", "name", "date", "week", "provider", "status", "eventsUrl", "rosterUrl", "resultsUrl", "isDemo", "polling", "createdAt", "startedAt",
  "finalAt", "lastSyncedAt", "lastAttemptAt", "nextSyncAt", "syncCount", "sourceError", "sourceErrorKind", "sourceErrorAt", "failures",
  "feedHash", "sourceUrl", "resolve", "feedChangedAt", "scope", "reprocessAt", "sourceMeetId", "sourceInfo", "history",
] as const;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback;
  return Math.min(max, Math.max(min, n));
};

export function cleanSettings(a: Record<string, unknown>, base: GameSettings): GameSettings {
  const st = { ...base };
  const has = (k: string): boolean => a[k] !== undefined;
  if (has("pickSeconds")) st.pickSeconds = clampInt(a.pickSeconds, 15, 3600, st.pickSeconds);
  if (has("regularWeeks")) st.regularWeeks = clampInt(a.regularWeeks, 1, 20, st.regularWeeks);
  if (has("playoffTeams")) st.playoffTeams = [0, 2, 4, 6, 8].includes(Number(a.playoffTeams)) ? Number(a.playoffTeams) : st.playoffTeams;
  if (has("consolation")) st.consolation = a.consolation === true;
  if (has("tiebreaker")) st.tiebreaker = a.tiebreaker === "h2h" ? "h2h" : "pf";
  if (has("waiverType")) st.waiverType = a.waiverType === "faab" ? "faab" : "rolling";
  if (has("waiverSchedule")) st.waiverSchedule = a.waiverSchedule === "daily" ? "daily" : "weekly";
  if (has("waiverDay")) st.waiverDay = clampInt(a.waiverDay, 0, 6, st.waiverDay);
  if (has("waiverDays")) st.waiverDays = clampInt(a.waiverDays, 0, 7, st.waiverDays);
  if (has("waiverHour")) st.waiverHour = clampInt(a.waiverHour, 0, 23, st.waiverHour);
  if (has("tzOffsetMin")) st.tzOffsetMin = clampInt(a.tzOffsetMin, -720, 840, st.tzOffsetMin);
  if (has("faabBudget")) st.faabBudget = clampInt(a.faabBudget, 0, 1000, st.faabBudget);
  if (has("maxAddsPerWeek")) st.maxAddsPerWeek = clampInt(a.maxAddsPerWeek, 0, 20, st.maxAddsPerWeek);
  if (has("tradeReview")) st.tradeReview = a.tradeReview === "none" ? "none" : a.tradeReview === "league" ? "league" : "commish";
  if (has("tradeReviewDays")) st.tradeReviewDays = clampInt(a.tradeReviewDays, 0, 3, st.tradeReviewDays);
  if (has("vetoVotes")) st.vetoVotes = clampInt(a.vetoVotes, 1, 13, st.vetoVotes);
  if (has("tradeDeadlineWeek")) st.tradeDeadlineWeek = clampInt(a.tradeDeadlineWeek, 0, 20, st.tradeDeadlineWeek);
  if (has("lineupLock")) st.lineupLock = a.lineupLock === "manual" ? "manual" : "results";
  return st;
}

export function cleanRoster(a: Record<string, unknown>, base: RosterRules): RosterRules {
  const out: RosterRules = { irSlot: base.irSlot, irStatuses: [...base.irStatuses], flexPositions: [...base.flexPositions] };
  if (a.irSlot !== undefined) out.irSlot = a.irSlot === true;
  if (Array.isArray(a.irStatuses)) {
    const v = (a.irStatuses as unknown[]).map(String).filter((x): x is "IR" | "O" | "Q" => x === "IR" || x === "O" || x === "Q");
    out.irStatuses = v.length > 0 ? [...new Set(v)] : ["IR"];
  }
  if (Array.isArray(a.flexPositions)) {
    const v = (a.flexPositions as unknown[]).map(String).filter((x): x is Pos => x === "SPR" || x === "DIS" || x === "FLD");
    if (v.length === 0) throw new GlobalError("FLEX needs at least one position.");
    out.flexPositions = (["SPR", "DIS", "FLD"] as Pos[]).filter((p) => v.includes(p));
  }
  return out;
}

export function cleanLive(a: Record<string, unknown>, base: LiveRules): LiveRules {
  return {
    pollSeconds: a.pollSeconds !== undefined ? clampInt(a.pollSeconds, 10, 300, base.pollSeconds) : base.pollSeconds,
    autoFinalMinutes: a.autoFinalMinutes !== undefined ? clampInt(a.autoFinalMinutes, 5, 240, base.autoFinalMinutes) : base.autoFinalMinutes,
    maxLiveHours: a.maxLiveHours !== undefined ? clampInt(a.maxLiveHours, 2, 72, base.maxLiveHours) : base.maxLiveHours,
  };
}

export function cleanNotices(a: Record<string, unknown>, base: NoticeRules): NoticeRules {
  const out = { ...base };
  for (const k of Object.keys(out) as NoticeCategory[]) if (typeof a[k] === "boolean") out[k] = a[k] as boolean;
  return out;
}

export function defaultConfig(mainLeagueId: string, now: number): GlobalConfig {
  return {
    version: 1, scoringVersion: 1, mainLeagueId, mainLeagueCode: MAIN_LEAGUE_CODE, mainCommissionerId: "", initializedAt: now, updatedAt: now, updatedBy: "system",
    rules: [{ since: 0, rules: cleanScoring({}), version: 1 }], tableVersion: 1, standards: [], performance: [],
    settings: { ...DEFAULT_SETTINGS }, roster: { ...DEFAULT_ROSTER, irStatuses: [...DEFAULT_ROSTER.irStatuses], flexPositions: [...DEFAULT_ROSTER.flexPositions] },
    live: { ...DEFAULT_LIVE }, notices: { ...DEFAULT_NOTICES }, meets: [], audit: [],
  };
}

/** Fills fields added after a config was first saved. */
export function normalizeConfig(c: GlobalConfig): GlobalConfig {
  c.rules = Array.isArray(c.rules) && c.rules.length > 0
    ? c.rules.map((r, i) => ({ since: r.since, rules: cleanScoring(r.rules), version: r.version ?? i + 1, by: r.by }))
    : [{ since: 0, rules: cleanScoring({}), version: 1 }];
  c.tableVersion ??= 1;
  c.standards ??= [];
  c.performance ??= [];
  c.settings = cleanSettings(c.settings ?? {}, DEFAULT_SETTINGS);
  c.roster = cleanRoster((c.roster ?? {}) as Record<string, unknown>, DEFAULT_ROSTER);
  c.live = cleanLive((c.live ?? {}) as Record<string, unknown>, DEFAULT_LIVE);
  c.notices = cleanNotices((c.notices ?? {}) as Record<string, unknown>, DEFAULT_NOTICES);
  // Demo meets (fake results) are retired: they never touched real scores and are no longer offered.
  c.meets = (c.meets ?? []).filter((m) => (m.provider as string) !== "DEMO");
  c.audit ??= [];
  c.scoringVersion ??= 1;
  c.mainLeagueCode = MAIN_LEAGUE_CODE;
  return c;
}

export function currentRules(c: Pick<GlobalConfig, "rules">): ScoringConfig {
  return (c.rules[c.rules.length - 1]?.rules) ?? DEFAULT_SCORING;
}

/** A timestamp-windowed global row applies to a week that closed at `t` (Infinity = still open). */
export function timeActive(row: { since?: number; until?: number | null }, t: number): boolean {
  return (row.since ?? 0) < t && (row.until === undefined || row.until === null || row.until >= t);
}

/** The point values that were in force at time `t` (the latest entry created before it). */
export function rulesAt(c: Pick<GlobalConfig, "rules">, t: number): ScoringConfig {
  let best: ScoringConfig = c.rules[0]?.rules ?? DEFAULT_SCORING;
  for (const r of c.rules) if (r.since < t) best = r.rules;
  return best;
}

/** Version label of the rule set and tables in force at time `t` (stamped on every scoring line). */
export function versionsAt(c: Pick<GlobalConfig, "rules" | "performance" | "tableVersion">, t: number): { scoring: number; tables: number; label: string } {
  let scoring = c.rules[0]?.version ?? 1;
  for (const r of c.rules) if (r.since < t) scoring = r.version ?? scoring;
  let tables = 0;
  for (const p of c.performance) if (timeActive(p, t)) tables = Math.max(tables, p.ver ?? 1);
  if (tables === 0) tables = c.tableVersion ?? 1;
  return { scoring, tables, label: `scoring v${scoring} · tables v${tables}` };
}

/**
 * The official Fantasy T&F time/mark tables supplied by the Main League commissioner (Oct 2026). Stored exactly as given:
 * every row is "mark or faster/higher/farther → points". The same values apply to each season 2026–2032, each saved as
 * its own editable table.
 */
export const OFFICIAL_TABLES: { gender: Gender; event: string; tiers: [string, number][] }[] = [
  { gender: "B", event: "55m", tiers: [["7.70", 0.5], ["7.30", 2], ["7.00", 5]] },
  { gender: "B", event: "60m", tiers: [["8.20", 0.5], ["7.80", 2], ["7.40", 5]] },
  { gender: "B", event: "200m", tiers: [["26.50", 0.5], ["25.00", 2], ["23.80", 5]] },
  { gender: "B", event: "300m", tiers: [["42.50", 0.5], ["39.80", 2], ["37.90", 5]] },
  { gender: "B", event: "400m", tiers: [["58.50", 0.5], ["54.80", 2], ["52.20", 5]] },
  { gender: "B", event: "High Jump", tiers: [["5-2", 0.5], ["5-8", 2], ["6-2", 5]] },
  { gender: "B", event: "Long Jump", tiers: [["17-0", 0.5], ["19-6", 2], ["21-6", 5]] },
  { gender: "B", event: "Triple Jump", tiers: [["35-0", 0.5], ["39-6", 2], ["43-0", 5]] },
  { gender: "B", event: "Pole Vault", tiers: [["9-6", 0.5], ["11-6", 2], ["13-6", 5]] },
  { gender: "B", event: "Shot Put", tiers: [["34-0", 0.5], ["41-0", 2], ["48-0", 5]] },
  { gender: "B", event: "Weight Throw", tiers: [["35-0", 0.5], ["45-0", 2], ["56-0", 5]] },
  { gender: "G", event: "55m", tiers: [["8.60", 0.5], ["8.15", 2], ["7.75", 5]] },
  { gender: "G", event: "60m", tiers: [["9.20", 0.5], ["8.70", 2], ["8.25", 5]] },
  { gender: "G", event: "200m", tiers: [["30.50", 0.5], ["28.80", 2], ["27.20", 5]] },
  { gender: "G", event: "300m", tiers: [["49.50", 0.5], ["45.80", 2], ["43.20", 5]] },
  { gender: "G", event: "400m", tiers: [["69.00", 0.5], ["64.50", 2], ["60.80", 5]] },
  { gender: "G", event: "High Jump", tiers: [["4-3", 0.5], ["4-8", 2], ["5-2", 5]] },
  { gender: "G", event: "Long Jump", tiers: [["13-6", 0.5], ["15-6", 2], ["17-3", 5]] },
  { gender: "G", event: "Triple Jump", tiers: [["28-6", 0.5], ["32-6", 2], ["36-0", 5]] },
  { gender: "G", event: "Pole Vault", tiers: [["7-0", 0.5], ["8-6", 2], ["10-6", 5]] },
  { gender: "G", event: "Shot Put", tiers: [["25-0", 0.5], ["30-6", 2], ["36-0", 5]] },
  { gender: "G", event: "Weight Throw", tiers: [["26-0", 0.5], ["34-0", 2], ["43-0", 5]] },
];
export const OFFICIAL_SEASONS = [2026, 2027, 2028, 2029, 2030, 2031, 2032];

export type MergeNote = { season: number; gender: Gender; event: string; mark: string; points: number; outcome: "added" | "kept" | "replaced" | "dropped"; reason: string };

/**
 * Merges a supplied tier list into one existing table. The supplied tiers are authoritative and always kept.
 * An existing tier stays only if it still fits: a better mark must always be worth strictly more, never the same mark
 * or the same points as a supplied tier. Same points → replaced by the supplied mark; out of order → dropped.
 * Every decision is returned so nothing changes silently.
 */
export function mergeTiers(
  event: string, gender: Gender, season: number, existing: { mark: string; points: number }[], supplied: [string, number][],
): { tiers: { mark: string; points: number }[]; notes: MergeNote[] } {
  const info = eventInfo(event);
  const time = measurementTypeOf(info.name) === "TIME";
  const val = (mark: string): number | null => measureForEvent(mark, info.name).m?.value ?? null;
  const better = (a: number, b: number): boolean => (time ? a < b - 1e-6 : a > b + 1e-6);
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  const notes: MergeNote[] = [];
  const base = { season, gender, event: info.name };
  const sup = supplied.map(([mark, points]) => ({ mark, points, v: val(mark) }));
  for (const s of sup) if (s.v === null) throw new GlobalError(`${info.name} ${s.mark}: unreadable supplied mark.`);
  const kept: { mark: string; points: number }[] = [];
  for (const o of existing) {
    const v = val(o.mark);
    if (v === null) { notes.push({ ...base, mark: o.mark, points: o.points, outcome: "dropped", reason: "unreadable mark" }); continue; }
    if (!(o.points >= 0.5)) { notes.push({ ...base, mark: o.mark, points: o.points, outcome: "dropped", reason: `worth +${o.points} (tiers must be worth at least 0.5, so it never paid anything)` }); continue; }
    const samePts = sup.find((s) => s.points === o.points);
    if (samePts) {
      notes.push({ ...base, mark: o.mark, points: o.points, outcome: same(v, samePts.v as number) ? "kept" : "replaced", reason: same(v, samePts.v as number) ? "identical to the supplied tier" : `supplied mark ${samePts.mark} replaces ${o.mark} at +${o.points}` });
      continue;
    }
    const sameMark = sup.find((s) => same(v, s.v as number));
    if (sameMark) { notes.push({ ...base, mark: o.mark, points: o.points, outcome: "dropped", reason: `same mark as supplied ${sameMark.mark} (+${sameMark.points})` }); continue; }
    const clash = sup.find((s) => (better(v, s.v as number) && o.points < s.points) || (better(s.v as number, v) && o.points > s.points));
    if (clash) {
      notes.push({ ...base, mark: o.mark, points: o.points, outcome: "dropped", reason: better(v, clash.v as number) ? `out of order: better than ${clash.mark} but worth less (+${o.points} < +${clash.points})` : `out of order: slower/shorter than ${clash.mark} but worth more (+${o.points} > +${clash.points})` });
      continue;
    }
    kept.push({ mark: o.mark, points: o.points });
    notes.push({ ...base, mark: o.mark, points: o.points, outcome: "kept", reason: "fits between the supplied tiers" });
  }
  const keptMarks = new Set(kept.map((k) => k.mark));
  for (const s of sup) if (!existing.some((o) => { const v = val(o.mark); return v !== null && same(v, s.v as number) && o.points === s.points; })) notes.push({ ...base, mark: s.mark, points: s.points, outcome: "added", reason: "supplied tier" });
  const tiers = [...sup.map((s) => ({ mark: s.mark, points: s.points })), ...kept.filter((k) => keptMarks.has(k.mark))];
  tiers.sort((a, b) => b.points - a.points);
  return { tiers, notes };
}

/** Validates a whole table without saving it. Returns every problem found (never silently accepted). */
export function validateTable(event: string, tiers: { mark: string; points: number }[]): string[] {
  const problems: string[] = [];
  const hit = PERFORMANCE_EVENTS.find((e) => keyOf(e) === keyOf(event));
  if (!hit) return [`${event}: not an individual track or field event.`];
  const measurement = measurementTypeOf(hit);
  const read: { mark: string; value: number; points: number }[] = [];
  for (const t of tiers) {
    const { m, issue } = measureForEvent(String(t.mark ?? "").trim(), hit);
    if (!m) { problems.push(`${hit} "${t.mark}": ${issue ?? "unreadable"}.`); continue; }
    if (!Number.isFinite(t.points) || t.points <= 0 || t.points > 50) problems.push(`${hit} ${t.mark}: points must be between 0.5 and 50 (got ${t.points}).`);
    if (read.some((x) => Math.abs(x.value - m.value) < 1e-6)) problems.push(`${hit}: ${t.mark} is listed twice.`);
    if (read.some((x) => x.points === t.points)) problems.push(`${hit}: two tiers are both worth ${t.points}.`);
    read.push({ mark: t.mark, value: m.value, points: t.points });
  }
  const ordered = [...read].sort((x, y) => (measurement === "TIME" ? x.value - y.value : y.value - x.value));
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1] as { mark: string; points: number };
    const b = ordered[i] as { mark: string; points: number };
    if (b.points > a.points) problems.push(`${hit}: ${b.mark} can't be worth more than the better mark ${a.mark}.`);
  }
  return problems;
}

/** Only the rows that currently apply (for editors). */
export function liveRows<T extends { until?: number | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.until === undefined || r.until === null);
}

// MARK: - Scoring edits (forward-only: old rows are retired with `until`, never rewritten)

export function setStandardRows(rows: Standard[], a: Record<string, unknown>, season0: number, now: number): { rows: Standard[]; label: string } {
  const str = (k: string): string => String(a[k] ?? "").trim();
  if (!str("event")) throw new GlobalError("Pick an event.");
  const info = eventInfo(str("event"));
  const gender: Gender = str("gender") === "G" ? "G" : "B";
  const season = clampInt(a.season, 2000, 2100, season0);
  const same = (x: Standard): boolean => x.gender === gender && keyOf(x.event) === keyOf(info.name) && x.season === season && (x.until === undefined || x.until === null);
  const next = rows.map((x) => (same(x) ? { ...x, until: now } : x));
  const cols: [StandardType, string][] = [["NB", "nb"], ["NIKE", "nike"], ["STATES", "states"]];
  for (const [type, k] of cols) {
    const mark = str(k).slice(0, 16);
    if (!mark) continue;
    const custom = a[`${k}Points`];
    next.push({
      id: `${gender}-${keyOf(info.name)}-${type}-${season}-${now}`, season, gender, event: info.name, type, mark,
      points: custom !== undefined ? clampInt(custom, 0, 20, STANDARD_DEFAULT_POINTS[type]) : STANDARD_DEFAULT_POINTS[type],
      active: a[`${k}Active`] !== false, since: now, until: null, scope: "global",
    });
  }
  return { rows: next, label: `${gender === "G" ? "Girls" : "Boys"} ${info.name} ${season}: NB ${str("nb") || "—"}, Nike ${str("nike") || "—"}, States ${str("states") || "—"}` };
}

export function toggleStandardRow(rows: Standard[], id: string, active: boolean, now: number): { rows: Standard[]; label: string } {
  const st = rows.find((x) => x.id === id && (x.until === undefined || x.until === null));
  if (!st) throw new GlobalError("Standard not found.");
  if (st.active === active) return { rows, label: `${st.type} ${st.event} unchanged` };
  const next = rows.map((x) => (x === st ? { ...x, until: now } : x));
  next.push({ ...st, id: `${st.id.replace(/-\d{13}$/, "")}-${now}`, active, since: now, until: null, scope: "global" });
  return { rows: next, label: `${active ? "Activated" : "Deactivated"} ${st.type} ${st.gender === "G" ? "Girls" : "Boys"} ${st.event}` };
}

export function setPerformanceRows(rows: PerformanceRule[], a: Record<string, unknown>, season0: number, now: number, ver?: number): { rows: PerformanceRule[]; label: string } {
  const event = String(a.event ?? "").trim();
  const hit = PERFORMANCE_EVENTS.find((e) => keyOf(e) === keyOf(event));
  if (!hit) throw new GlobalError("Performance tables are for individual track and field events.");
  const measurement = measurementTypeOf(hit);
  if (!measurement) throw new GlobalError("That event can't have a performance table.");
  const g = String(a.gender ?? "");
  const gender: Gender | "X" = g === "B" || g === "G" ? g : "X";
  const season = clampInt(a.season, 2000, 2100, season0);
  const raw = Array.isArray(a.tiers) ? (a.tiers as Record<string, unknown>[]) : [];
  if (raw.length > 12) throw new GlobalError("Use at most 12 tiers per table.");
  const tiers: PerformanceRule[] = [];
  for (const t of raw) {
    const mark = String(t.mark ?? "").trim().slice(0, 16);
    const { m, issue } = measureForEvent(mark, hit);
    if (!m) throw new GlobalError(`${hit}: ${issue ?? "unreadable mark"}.`);
    const points = Number(t.points);
    if (!Number.isFinite(points) || points <= 0 || points > 50) throw new GlobalError(`${hit} ${mark}: points must be between 0.5 and 50.`);
    if (tiers.some((x) => Math.abs(x.value - m.value) < 1e-6)) throw new GlobalError(`${hit}: ${mark} is listed twice.`);
    tiers.push({
      id: `${gender}-${keyOf(hit)}-${season}-${Math.round(m.value * 10000)}-${now}`, season, gender, event: hit, measurement, mark,
      value: Math.round(m.value * 1_000_000) / 1_000_000, points: Math.round(points * 100) / 100, active: t.active !== false, updatedAt: now,
      since: now, until: null, scope: "global", ver,
    });
  }
  const ordered = [...tiers].sort((x, y) => (measurement === "TIME" ? x.value - y.value : y.value - x.value));
  for (let i = 1; i < ordered.length; i++) {
    if ((ordered[i] as PerformanceRule).points > (ordered[i - 1] as PerformanceRule).points) {
      throw new GlobalError(`${hit}: ${(ordered[i] as PerformanceRule).mark} can't be worth more than the better mark ${(ordered[i - 1] as PerformanceRule).mark}.`);
    }
  }
  const same = (p: PerformanceRule): boolean => p.season === season && p.gender === gender && keyOf(p.event) === keyOf(hit) && (p.until === undefined || p.until === null);
  const next = [...rows.map((p) => (same(p) ? { ...p, until: now } : p)), ...tiers];
  const label = `${gender === "X" ? "All" : gender === "G" ? "Girls" : "Boys"} ${hit} ${season}`;
  return { rows: next, label: `${label}: ${ordered.length === 0 ? "cleared" : ordered.map((t) => `${t.mark}=+${t.points}`).join(", ")}` };
}

// MARK: - Meets

export function blankGlobalMeet(id: string, week: number, now: number): Meet {
  return {
    id, name: "", date: "", week, provider: "ATHLETICLIVE", status: "UPCOMING", eventsUrl: "", rosterUrl: "", resultsUrl: "",
    isDemo: false, polling: false, createdAt: now, startedAt: null, finalAt: null, lastSyncedAt: null, lastAttemptAt: null,
    nextSyncAt: null, syncCount: 0, sourceError: null, sourceErrorAt: null, failures: 0, stats: emptyStats(), demo: null, scope: "global",
  };
}

/** Validates and applies Add/Edit Meet fields. Throws GlobalError with a user-facing message. */
export function applyMeetFields(m: Meet, a: Record<string, unknown>, maxWeek: number): void {
  const str = (k: string): string => String(a[k] ?? "").trim();
  const has = (k: string): boolean => a[k] !== undefined;
  if (has("name")) m.name = str("name").slice(0, 60);
  if (has("date")) {
    const d = str("date");
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new GlobalError("Enter the meet date.");
    m.date = d;
  }
  if (has("week")) m.week = clampInt(a.week, 1, Math.max(1, maxWeek), m.week);
  if (has("history")) m.history = a.history === true;
  if (has("provider")) {
    const p = str("provider").toUpperCase();
    if (p === "DEMO") throw new GlobalError("Demo meets were removed. Use the Meet Test Lab to try a real past meet.");
    m.provider = p === "MANUAL" ? "MANUAL" : "ATHLETICLIVE";
    m.isDemo = false;
  }
  if (has("sourceUrl")) {
    const v = str("sourceUrl").slice(0, 800);
    if (v && !/^https?:\/\//i.test(v)) throw new GlobalError("The meet link must start with https://");
    if (v !== (m.sourceUrl ?? "")) { m.resolve = null; m.sourceMeetId = null; m.sourceInfo = null; }
    m.sourceUrl = v;
  }
  for (const k of ["eventsUrl", "rosterUrl", "resultsUrl"] as const) {
    if (!has(k)) continue;
    const v = str(k).slice(0, 800);
    if (v && !/^https?:\/\//i.test(v)) throw new GlobalError("Source URLs must start with https://");
    m[k] = v;
  }
  if (!m.name) throw new GlobalError("Enter the meet name.");
}

/** Minutes east of UTC for US Eastern time at instant `t` (handles daylight saving). Falls back to `fallbackMin`. */
export function easternOffsetMin(t: number, fallbackMin = -240): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t));
    const get = (k: string): number => Number(parts.find((p) => p.type === k)?.value ?? "0");
    const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const off = Math.round((local - Math.floor(t / 60_000) * 60_000) / 60_000);
    return Number.isFinite(off) && Math.abs(off) <= 840 ? off : fallbackMin;
  } catch {
    return fallbackMin;
  }
}

/**
 * The next weekly waiver run strictly after `after`: weekday `day` (0 = Sunday) at `hour`:00 US Eastern.
 * Example: day 3, hour 3 → the next Wednesday at 3:00 AM Eastern.
 */
export function nextWeeklyRun(after: number, day: number, hour: number): number {
  const off0 = easternOffsetMin(after);
  const local = new Date(after + off0 * 60_000);
  for (let i = 0; i <= 8; i++) {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i, hour, 0, 0));
    if (d.getUTCDay() !== day) continue;
    const guess = d.getTime() - off0 * 60_000;
    const utc = d.getTime() - easternOffsetMin(guess) * 60_000;
    if (utc > after) return utc;
  }
  return after + 7 * 86_400_000;
}

/** Copies only the global fields of a meet (what every league and the website see). */
export function globalMeetFields(m: Meet): Partial<Meet> {
  const out: Record<string, unknown> = {};
  for (const k of GLOBAL_MEET_KEYS) out[k] = (m as unknown as Record<string, unknown>)[k];
  return out as Partial<Meet>;
}
