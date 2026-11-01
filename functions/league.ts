import { DurableObject } from "cloudflare:workers";
import { normalizeName, seedAthletes, type Pos } from "./seed";
import {
  categoryOf, cleanScoring, computeAll, computeLines, describeMark, eventInfo, EVENT_NAMES, keyOf, measureForEvent, measurementTypeOf, ordinal, PERFORMANCE_EVENTS, resultKey,
  seasonOf, standardsFromRows, STANDARD_DEFAULT_POINTS, CATEGORIES,
  type BestOverride, type Fumble, type Gender, type History, type Line, type PerformanceRule, type Result, type ResultStatus, type SchoolRecord,
  type ScoringInput, type Standard, type StandardRow, type StandardType,
} from "./scoring";
import {
  emptyStats, fetchAthleticLive, getText, normalizeFeed, parseCsv, parseSchedule, resolveMeetLink, SourceError,
  type Meet, type NormalizeOutput, type NormalizedMeetResult, type Provider, type RawFeed,
} from "./meets";
import { aliveImport, checkSource, fetchMeetFeed, incompleteImport, resolveAliveUrl, verifyMeet, type AliveImport, type Fault, type SourceStep } from "./alive";
import { hasTable, MODEL_VERSION, project, winProbability, type Projection } from "./projections";
import { bibKey, fullNorm, matchPoolAthlete, nameKey, type Mapping, type PoolAthlete, type PoolMatch, type SourceAthlete, type SourceLink } from "./live";
import { identityKey, isPoolSchool, looseNameMatch, norm, normSchool, POOL_SCHOOL, poolSchoolOf } from "./names";
import { DEFAULT_ADP, resolveAdp, type AdpEntry } from "./adp";
import { Db } from "./db";
import {
  currentRules, GLOBAL_MEET_KEYS, GLOBAL_SETTING_KEYS, liveRows, MAIN_LEAGUE_CODE, nextWeeklyRun, normalizeConfig, rulesAt, SHAPE_KEYS, timeActive,
  validateTable, versionsAt, type GlobalConfig,
} from "./global";
import { DEFAULT_SCORING, weekWindow, type RuleWindow, type ScoringConfig } from "./scoring";
import { removeStale, sendPush, statsVerdict, userProblem, viewUser, waitForStats } from "./push";
import { auditLines, maxBreakdown, scenarioLines, scenarioMetrics, type Game as AuditGame } from "./audit";
import { backtest, checkSchedule, labResults, profileFields, regenerate, relayLab, seedLab, type Contest, type Game } from "./labs";
import { pastedToCsv } from "./pasted";

/** One meet in the projection library (projections only; never scored). */
type ProjMeet = {
  id: string;
  kind: "ATHLETICLIVE" | "TEXT";
  name: string;
  date: string;
  url?: string;
  sourceMeetId?: string;
  builtin?: boolean;
  addedAt: number;
  by: string;
};
type ProjMeetStat = { at: number; results: number; athletes: number; error?: string | null; kept?: boolean };
type ProjLib = { at: number; sig: string; byMeet: Record<string, Result[]>; stats: Record<string, ProjMeetStat> };

type Env = {
  DO: Fetcher & {
    setAlarm(className: string, id: string, scheduledTime: number | Date): Promise<void>;
    getAlarm(className: string, id: string): Promise<number | null>;
    deleteAlarm(className: string, id: string): Promise<void>;
  };
  ONESIGNAL_APP_ID?: string;
  ONESIGNAL_REST_API_KEY?: string;
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  TD_DB_SECRET?: string;
  EXPO_PUBLIC_TOOLKIT_URL?: string;
  EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY?: string;
};

type AthStatus = "active" | "Q" | "O" | "IR";

/**
 * League-scoped athlete record. Identity (name/school/gender/positions) plus league presentation: `photoAt` is the
 * version of this league's commissioner-set headshot (blob stored at `aphoto:<athleteId>:<photoAt>` in this league only).
 */
type Athlete = {
  id: string; name: string; gender: Gender; positions: Pos[]; flex: boolean; note: string; rank: number; school?: string; status?: AthStatus; rev?: number; photoAt?: number;
  /** The headshot comes from the master player database (served globally), not from this league. */
  masterPhoto?: boolean;
  /** Headshot crop hints saved with the master photo (0..1 focus point + zoom). */
  crop?: { x: number; y: number; zoom: number } | null;
};

/** The fantasy position options a commissioner can assign. Stored structurally as positions[] + flex. */
const POSITION_CODES: Record<string, { positions: Pos[]; flex: boolean; label: string }> = {
  "SPR": { positions: ["SPR"], flex: false, label: "Sprinter" },
  "SPR/DIS": { positions: ["SPR", "DIS"], flex: false, label: "Sprinter/Distance" },
  "SPR/FLD": { positions: ["SPR", "FLD"], flex: false, label: "Sprinter/Field" },
  "DIS": { positions: ["DIS"], flex: false, label: "Distance" },
  "DIS/FLD": { positions: ["DIS", "FLD"], flex: false, label: "Distance/Field" },
  "FLD": { positions: ["FLD"], flex: false, label: "Field" },
  "FLEX": { positions: ["SPR", "DIS", "FLD"], flex: true, label: "Flex" },
};

/** Canonical position code for an athlete ("SPR/DIS", "FLEX", …). Display/transport only; eligibility uses positions[]. */
const posCode = (a: { positions: Pos[]; flex: boolean }): string => (a.flex ? "FLEX" : (["SPR", "DIS", "FLD"] as Pos[]).filter((p) => a.positions.includes(p)).join("/"));

/** Largest accepted headshot (base64 characters). Keeps each stored value well under the storage value limit. */
const MAX_PHOTO_B64 = 120_000;

/** Row of the master athlete list (Directory). */
type MasterAthlete = {
  id: string; name: string; gender: Gender; positions: Pos[]; flex: boolean; note: string; rank: number; school: string; rev: number;
  status?: AthStatus; photoAt?: number | null; crop?: { x: number; y: number; zoom: number } | null; retired?: boolean;
};

/** Player changes that belong to the master player database (Main League commissioner only, applied to every league). */
const MASTER_ACTIONS = new Set(["addAthlete", "editAthlete", "setStatus", "removeAthlete"]);

const STATUS_LABEL: Record<AthStatus, string> = { active: "Active", Q: "Questionable", O: "Out", IR: "IR" };

type Unmatched = {
  id: string;
  meetId: string;
  kind: "athlete" | "event" | "relay" | "mark";
  key: string;
  mapKeys: string[];
  sourceName: string;
  school: string;
  gender: string;
  bib: string;
  eventName: string;
  result: string;
  candidates: string[];
  relevant: boolean;
  status: "open" | "resolved" | "dismissed";
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolvedAthleteId: string | null;
  /** Persistent source athlete id behind this item (source-id conflicts are resolved against it). */
  sourceId?: string | null;
};

type Audit = { id: string; at: number; actorId: string; actorName: string; action: string; detail: string };

type DemoRow = { athleteId: string; points: number; events: number };

type Weak = { kind: "athlete" | "relay"; src: SourceAthlete; mapKeys: string[]; candidates: string[]; rows: NormalizedMeetResult[]; note?: string };

type Analysis = {
  rowIds: Map<string, string[]>;
  matchType: Map<string, string>;
  weak: Map<string, Weak>;
  sourceAthletes: number;
  matchedIds: Set<string>;
  relevantIds: Set<string>;
  /** Source athlete identity → the evidence and decision for it. */
  evidence: Map<string, { src: SourceAthlete; match: PoolMatch }>;
  /** Result row id → source athlete identity (individual rows). */
  rowSrc: Map<string, string>;
  /** Distinct source athletes who are Cornwall Central. */
  poolAthletes: number;
};

type SlotId = "SPR" | "DIS" | "FLD" | "FLEX" | "BN1" | "BN2" | "IR";

type Team = {
  id: string;
  ownerName: string;
  teamName: string;
  color: string;
  lineup: Record<SlotId, string | null>;
  queue: string[];
  waiverPriority: number;
  faab: number;
  addsThisWeek: number;
  joinedAt: number;
  avatarAt?: number | null;
  /** At most one co-manager per team. Never the commissioner automatically. */
  coManagerId?: string | null;
  coManagerName?: string | null;
  /** Open co-manager invite (code registered in the Directory). */
  coInvite?: { code: string; at: number } | null;
};

/** A player locked into the spot they held when their first event of the week started. */
type Lock = { at: number; event: string; meetId: string; teamId: string | null; slot: SlotId | null; reason: "start" | "result" };

/** `slot` = draft position (1-based) this person picked; null = random. */
type MockSeat = { id: string; userId: string | null; name: string; bot: boolean; slot?: number | null };
type MockPick = { overall: number; round: number; pickInRound: number; seatId: string; athleteId: string; auto: boolean; at: number };
/** A practice draft. Stored under its own key; never touches real rosters, ownership, draft, standings or history. */
type Mock = {
  id: string; kind: "solo" | "league"; ownerId: string; ownerName: string; createdAt: number; updatedAt: number;
  status: "lobby" | "live" | "done"; seats: MockSeat[]; order: string[]; picks: MockPick[];
  lineups: Record<string, Record<SlotId, string | null>>; pickSeconds: number; deadline: number | null; version: number;
};

type Pick = { overall: number; round: number; pickInRound: number; teamId: string; athleteId: string; auto: boolean; at: number };

type Draft = {
  order: string[];
  picks: Pick[];
  status: "pending" | "live" | "paused" | "done";
  deadline: number | null;
  pausedRemaining: number | null;
  startedAt: number | null;
};

type MatchKind = "regular" | "playoff" | "consolation";

type Matchup = {
  id: string; week: number; homeId: string; awayId: string | null; final: boolean; kind: MatchKind; round: string | null;
  /** Scores frozen at finalization so later changes never alter a completed matchup. */
  homeFinal?: number | null; awayFinal?: number | null; finalAt?: number | null;
};

type BracketGame = {
  id: string;
  top: string | null;
  bottom: string | null;
  topSeed: number | null;
  bottomSeed: number | null;
  winnerId: string | null;
};

type BracketRound = { week: number; name: string; games: BracketGame[] };

type Bracket = { size: number; teams: number; seeded: boolean; seeds: string[]; rounds: BracketRound[]; championId: string | null };

type TradeStatus = "pending" | "review" | "accepted" | "declined" | "cancelled" | "vetoed" | "failed" | "countered";

type Trade = {
  id: string;
  fromId: string;
  toId: string;
  give: string[];
  get: string[];
  message: string;
  status: TradeStatus;
  createdAt: number;
  resolvedAt: number | null;
  reviewUntil: number | null;
  vetoes: string[];
  counterOf: string | null;
};

type Claim = {
  id: string;
  teamId: string;
  addId: string;
  dropId: string | null;
  bid: number;
  createdAt: number;
  status: "pending" | "won" | "lost" | "cancelled";
  resolvedAt: number | null;
  reason: string;
  /** This team's own order for its claims (1 = try first). */
  rank?: number;
};

/** One completed league move. `otherId` is the second team in a trade. Pending claims/offers are never written here. */
type Tx = { id: string; kind: string; teamId: string | null; text: string; at: number; athleteIds: string[]; otherId?: string | null; status?: "completed" | "vetoed" };

type NoteCategory = "player" | "trades" | "waivers" | "draft" | "live" | "league";

type NoteLink = { type: "player" | "trades" | "transactions" | "draft" | "matchup" | "activity" | "playoffs" | "none"; id?: string | null; week?: number | null };

type Note = { id: string; at: number; title: string; body: string; kind: string; targets: string[] | null; category?: NoteCategory; link?: NoteLink; key?: string };

type NoteOpts = { category?: NoteCategory; link?: NoteLink; key?: string };

type Push = { title: string; body: string; category: NoteCategory; targets: string[]; data: Record<string, unknown> };

/** One recoverable snapshot of a league's results + scoring (stored in chunks). */
type SnapMeta = { at: number; reason: string; results: number; chunks: number; points: number; linesHash: string };

/** Delivery audit for one logical notification. */
type NoteLog = {
  deliveryKey: string; noteId: string; eventKey: string | null; category: NoteCategory; leagueId: string; title: string; recipients: number;
  createdAt: number; attempts: number; status: "queued" | "delivered" | "sent" | "no-devices" | "failed" | "skipped"; error: string | null; link: string;
  oneSignalId: string | null;
  /** APNs outcome reported back by OneSignal (accepted / invalid token / provider error). */
  apns?: { successful: number; failed: number; errored: number; received: number | null } | null;
  /** Per-recipient reason when a recipient had no usable device. */
  reasons?: string[];
  staleRemoved?: number;
};

type Settings = {
  maxTeams: number;
  draftAt: number | null;
  draftOrderMode: "random" | "manual";
  pickSeconds: number;
  regularWeeks: number;
  playoffTeams: number;
  consolation: boolean;
  tiebreaker: "pf" | "h2h";
  waiverType: "rolling" | "faab";
  waiverSchedule: "weekly" | "daily";
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

type State = {
  schema: 2;
  id: string;
  name: string;
  code: string;
  commissionerId: string;
  createdAt: number;
  season: number;
  phase: "predraft" | "drafting" | "season" | "complete";
  settings: Settings;
  teams: Team[];
  athletes: Athlete[];
  draft: Draft;
  week: number;
  schedule: Matchup[];
  bracket: Bracket | null;
  lineupSnapshots: Record<string, Record<string, Record<SlotId, string | null>>>;
  waivers: Record<string, number>;
  claims: Claim[];
  trades: Trade[];
  transactions: Tx[];
  notifications: Note[];
  version: number;
  meets: Meet[];
  mappings: Record<string, Mapping>;
  unmatched: Unmatched[];
  eventMap: Record<string, string>;
  audit: Audit[];
  adpNames: string[];
  adp: AdpEntry[];
  /** userId → read watermark + individually read notification ids (synced across that user's devices). */
  reads: Record<string, { at: number; ids: string[] }>;
  /** Dedupe keys of notifications already created. */
  noteKeys: string[];
  /** Logical notifications blocked as duplicates (same event key). */
  noteDupes?: number;
  /** Import integrity counters: re-delivered results applied once (unchanged), corrections, removals. */
  integrity?: { unchanged: number; corrections: number; removed: number; imports: number };
  /** "resultId|athleteId" → points last announced, so repeats never re-notify and corrections notify once. */
  notedPoints: Record<string, number>;
  /** Highest master-list revision applied to this league (undefined = never synced). */
  poolRev?: number;
  /** Master athletes this league removed from its own pool. */
  poolExcluded?: string[];
  /** record key → [league version it last changed at, client that changed it]. Stale-write protection. */
  touched?: Record<string, [number, string]>;
  /** Recently applied client request ids, so a retried request never runs twice. */
  requestIds?: string[];
  /** Days (YYYY-MM-DD) with a stored daily backup. */
  backupDays?: string[];
  /** week → athleteId → lock. Written by the server the moment each player's event starts. */
  locks?: Record<string, Record<string, Lock>>;
  /** When this league switched to the Main League's global setup. Weeks closed before this keep their own old rules. */
  globalSince?: number;
  /**
   * TEST LEAGUES ONLY (never the Main League): versioned sandbox scoring rules used by this league's engine and
   * projections instead of the global rules. Picked by when each week closed, so finished weeks stay frozen.
   */
  sandboxRules?: { since: number; version: number; rules: ScoringConfig; by: string; note: string }[];
  /** Throwaway test league with a sandbox Admin Panel (set once, never on the Main League). */
  qaSandbox?: boolean;
  /** Season shape frozen when the draft started; global shape changes apply at the next draft. */
  shape?: { regularWeeks: number; playoffTeams: number; consolation: boolean };
  /** Global scoring version last applied (drives one rescore of open weeks per change). */
  scoringSeen?: number;
  /** Waiver schedule signature last applied (a schedule change moves every pending waiver to the new run time). */
  waiverSig?: string;
  /** Draft order as it stood when the current draft started (Reset Draft returns to it). */
  draftOrderAtStart?: string[];
  /** The finished week stays on screen until this time (next Monday 12:00 AM Eastern), then the next week activates. */
  advanceAt?: number | null;
  /** Commissioner schedule changes (regenerate / edit), newest last. */
  scheduleLog?: { at: number; by: string; byId: string; action: string; detail: string; fromWeek: number }[];
};

type Before = {
  violations: Set<string>;
  snaps: Map<string, string>;
  settings: string;
  lineups: Map<string, string>;
  statuses: Map<string, string>;
  ident: Map<string, string>;
  meets: Map<string, string>;
};

type Scoring = {
  records: SchoolRecord[];
  fumbles: Fumble[];
  standards: Standard[];
  pbs: Record<string, Record<string, string>>;
  /** Fantasy T&F time/mark performance tables (commissioner-configured; empty until set). */
  performance: PerformanceRule[];
  /** First fantasy week scored with heat/flight placement (+3/+2/+1). Earlier, already-finished weeks keep the old +2 heat win. */
  heatRuleFromWeek?: number;
};

type User = { id: string; name: string };

class ActionError extends Error {}
/** The league doesn't exist (never created, or deleted). */
class NotFoundError extends Error {}
/** The caller isn't allowed to do this. */
class ForbiddenError extends Error {}
/** A stale client tried to overwrite a record that changed after it last loaded. */
class ConflictError extends Error {}
/** A change would have broken a league invariant; nothing is saved. */
class IntegrityError extends Error {}

/** Actions that change the global Fantasy T&F setup. They're forwarded to the Directory, never applied locally. */
const GLOBAL_ACTIONS = new Set([
  "setStandard", "toggleStandard", "setPerformanceTable", "updateScoring", "updateGlobalSettings", "updateRoster", "updateLive", "updateNotices",
  "createMeet", "updateMeet", "deleteMeet", "resolveMeet", "startLive", "stopLive", "syncMeet", "markFinal", "reopenMeet",
  "reprocessMeet", "pauseAllLive", "resumeAllLive", "restorePoint",
]);

/** Admin Panel tool ops (every one re-checks access on the server). */
const ADMIN_OPS = new Set(["scoringExport", "liveActivityPreview", "projMeets", "projMeetPreview", "projMeetAdd", "projMeetRemove", "projMeetsRebuild", "adminAccess", "draftLoad", "draftSave", "draftClear", "draftPreview", "sandboxPublish", "sandboxRestore", "adminVersions", "changelog", "projHealth", "validateData", "audit", "backtestArmory", "fingerprint", "enableSandbox"]);

const DIR_HEADERS = { "Content-Type": "application/json", "X-Rork-DO-Class": "Directory", "X-Rork-DO-Id": "global" };
/** Last season's (2025-26) Armory meets on AthleticLIVE: the projection library's real source data. */
const PROJECTION_LIBRARY_MEETS: [string, string][] = [
  ["54930", "2025-12-12"], ["54946", "2025-12-20"], ["54949", "2026-01-02"], ["54953", "2026-01-09"],
  ["54959", "2026-01-16"], ["54976", "2026-02-07"], ["58418", "2026-02-16"],
];
const HOT_TX = 300;
const HOT_NOTES = 300;
const HOT_AUDIT = 400;
const BACKUP_DAYS = 30;
const pad = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(15, "0");

const SLOT_IDS: SlotId[] = ["SPR", "DIS", "FLD", "FLEX", "BN1", "BN2", "IR"];
const STARTERS: SlotId[] = ["SPR", "DIS", "FLD", "FLEX"];
const SLOT_POS: Partial<Record<SlotId, Pos>> = { SPR: "SPR", DIS: "DIS", FLD: "FLD" };
/** Six draft rounds fill Sprinter, Distance, Field, Flex and both Bench spots; the Injured spot starts empty. */
const ROUNDS = 6;
const POLL_MS = 15_000;
const MAX_LIVE_MS = 16 * 3600_000;
const AUTO_FINAL_QUIET_MS = 30 * 60_000;
const DRAFT_EDIT_CUTOFF_MS = 30 * 60_000;

/**
 * Rehearsal meets only: shows the importer a slice of the REAL feed (arrival order, live state, official corrections).
 * The data is never invented: rows are only withheld, marked unofficial, or have one published field changed exactly
 * as a timer's official correction would.
 */
function applyTestMode(feed: RawFeed, mode: NonNullable<Meet["testMode"]>): RawFeed {
  const rows = parseCsv(feed.results);
  const head = rows[0] ?? [];
  if (head.length === 0) return feed;
  const ci = (n: string): number => head.indexOf(n);
  const q = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const include = mode.include && mode.include.length > 0 ? new Set(mode.include) : null;
  const seen = new Map<string, number>();
  const body: string[][] = [];
  for (const r of rows.slice(1)) {
    const c = [...r];
    const ev = c[ci("EventId")] ?? "";
    if (include && !include.has(ev)) continue;
    if (mode.partial) {
      const n = (seen.get(ev) ?? 0) + 1;
      seen.set(ev, n);
      if (ci("Final") >= 0) c[ci("Final")] = "N";
      if (n % 2 === 0) for (const k of ["Place", "HeatPlace", "Result", "Status"]) if (ci(k) >= 0) c[ci(k)] = "";
    }
    for (const mu of mode.mutate ?? []) {
      const name = `${c[ci("FirstName1")] ?? ""} ${c[ci("LastName1")] ?? ""}`.trim().toLowerCase();
      if (ev !== mu.eventId || name !== mu.athlete.trim().toLowerCase()) continue;
      for (const [k, v] of Object.entries(mu.set)) if (ci(k) >= 0) c[ci(k)] = String(v);
    }
    body.push(c);
  }
  return { ...feed, results: [head.join(","), ...body.map((c) => c.map(q).join(","))].join("\n") };
}

/** Short stable id from any string (FNV-1a, two seeds). */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

const iso = (t: number | null): string | null => (t ? new Date(t).toISOString() : null);

const COLORS = [
  "#20C463", "#D8A83E", "#3FA7FF", "#FF5A5F", "#B47CFF", "#FF9F1C",
  "#2EC4B6", "#F15BB5", "#9BE564", "#E4572E", "#5BC0EB", "#FDE74C", "#8D99AE", "#06D6A0",
];

const uid = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback;
  return Math.min(max, Math.max(min, n));
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const emptyLineup = (): Record<SlotId, string | null> => ({ SPR: null, DIS: null, FLD: null, FLEX: null, BN1: null, BN2: null, IR: null });
const DAY = 86_400_000;

function defaultSettings(): Settings {
  return {
    maxTeams: 12, draftAt: null, draftOrderMode: "random", pickSeconds: 90,
    regularWeeks: 8, playoffTeams: 4, consolation: false, tiebreaker: "pf",
    waiverType: "rolling", waiverSchedule: "weekly", waiverDay: 3, waiverDays: 2, waiverHour: 3, tzOffsetMin: -240, faabBudget: 100, maxAddsPerWeek: 0,
    tradeReview: "commish", tradeReviewDays: 1, vetoVotes: 3, tradeDeadlineWeek: 0, lineupLock: "results",
  };
}

function roundName(fromEnd: number): string {
  if (fromEnd === 0) return "Championship";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Playoff Round ${fromEnd}`;
}

/** Standard bracket seed order for a power-of-two bracket (1v8, 4v5, 3v6, 2v7…). */
function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export class League extends DurableObject<Env> {
  private state: State | null = null;
  private scoring: Scoring = { records: [], fumbles: [], standards: [], pbs: {}, performance: [] };
  private results: Map<string, Result> = new Map();
  private lines: Line[] = [];
  private history: History = {};
  private pts: Record<string, Record<string, number>> = {};
  private linesHash = "";
  private scoringDirty = false;
  private db: Db;
  private mocks: Map<string, Mock> = new Map();
  private projCache: Map<string, { key: string; at: number; data: Record<string, Projection> }> = new Map();
  /** Cached copy of the Directory's global config (pushed on every change). Never edited here. */
  private global: GlobalConfig | null = null;
  private globalFetchedAt = 0;
  private sharedHistory: { fetchedAt: number; hash: string; results: Result[]; pbs: Record<string, Record<string, string>> } | null = null;
  private applying: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new Db(env);
    this.ctx.blockConcurrencyWhile(async () => {
      const raw = (await this.ctx.storage.get<Record<string, unknown>>("state")) ?? null;
      if (raw && raw.schema === 2) {
        this.state = raw as unknown as State;
      } else if (raw) {
        this.state = this.migrate(raw);
        await this.ctx.storage.put("state", this.state);
      }
      if (this.state) this.ensureFields(this.state);
      const sc = (await this.ctx.storage.get<Record<string, unknown>>("scoring")) ?? {};
      const season = this.state?.season ?? new Date().getFullYear();
      this.scoring = {
        records: Array.isArray(sc.records) ? (sc.records as SchoolRecord[]) : [],
        fumbles: Array.isArray(sc.fumbles) ? (sc.fumbles as Fumble[]) : [],
        standards: Array.isArray(sc.standards)
          ? (sc.standards as Standard[])
          : standardsFromRows((sc.standards ?? {}) as Record<string, StandardRow>, season),
        pbs: (sc.pbs ?? {}) as Record<string, Record<string, string>>,
        performance: Array.isArray(sc.performance) ? (sc.performance as PerformanceRule[]) : [],
        heatRuleFromWeek: typeof sc.heatRuleFromWeek === "number" ? sc.heatRuleFromWeek : undefined,
      };
      if (this.state && this.scoring.heatRuleFromWeek === undefined) {
        // One-time: weeks already final keep the old heat rule so finished matchups never change.
        this.scoring.heatRuleFromWeek = this.lastCompletedWeek() + 1;
        await this.ctx.storage.put("scoring", this.scoring);
      }
      const list = await this.ctx.storage.list<Result>({ prefix: "res:" });
      for (const r of list.values()) this.results.set(r.id, r);
      const mocks = await this.ctx.storage.list<Mock>({ prefix: "mock:" });
      for (const v of mocks.values()) this.mocks.set(v.id, v);
      const g = await this.ctx.storage.get<GlobalConfig>("global");
      if (g) this.global = normalizeConfig(g);
      this.recompute();
      this.scoringDirty = false;
    });
  }

  /** Adds fields introduced after a league was created. */
  private ensureFields(s: State): void {
    s.meets ??= [];
    s.mappings ??= {};
    s.unmatched ??= [];
    s.eventMap ??= {};
    s.audit ??= [];
    s.reads ??= {};
    s.noteKeys ??= [];
    s.notedPoints ??= {};
    if (!Array.isArray(s.adpNames)) {
      s.adpNames = [...DEFAULT_ADP];
      s.adp = resolveAdp(s.adpNames, s.athletes);
    }
    s.adp ??= resolveAdp(s.adpNames, s.athletes);
    for (const m of s.meets) m.stats ??= emptyStats();
    s.settings.waiverSchedule ??= "weekly";
    s.settings.waiverDay ??= 3;
  }

  // MARK: - Master player database (who the player is). Ownership, lineups and history stay in this league.

  private poolFetchedAt = 0;
  private poolLoading: Promise<void> | null = null;

  /** Pulls master-player changes newer than this league has seen (background, at most once a minute). */
  private syncPool(): void {
    if (!this.state || this.poolLoading || Date.now() - this.poolFetchedAt < 60_000) return;
    this.poolFetchedAt = Date.now();
    this.poolLoading = (async () => {
      try {
        const r = await this.dirGet(`/athletes?since=${this.state?.poolRev ?? 0}`);
        if (!r.ok) return;
        const body = (await r.json()) as { athletes?: MasterAthlete[] };
        if (this.state && this.applyMaster(body.athletes ?? [], false)) await this.save();
      } catch (e) {
        console.warn("master pool sync failed", String(e));
      } finally {
        this.poolLoading = null;
      }
    })();
    this.ctx.waitUntil(this.poolLoading);
  }

  /**
   * Applies master rows (newer revision only). Identity, positions, status, notes and headshot come from the master
   * record. Owned players are never removed; their owner's current lineup is re-solved if positions change (locked
   * players stay put). Past weeks, scores and transactions are never rewritten.
   */
  private applyMaster(rows: MasterAthlete[], force: boolean): boolean {
    const s = this.require();
    const excluded = new Set(s.poolExcluded ?? []);
    let changed = false;
    let maxRev = s.poolRev ?? 0;
    for (const m of rows) {
      if (!m?.id || !Array.isArray(m.positions)) continue;
      maxRev = Math.max(maxRev, m.rev ?? 0);
      let a = this.maybeAthlete(m.id);
      if (!a) {
        if (m.retired || excluded.has(m.id)) continue;
        a = { id: m.id, name: m.name, gender: m.gender, positions: [...m.positions], flex: m.flex, note: m.note ?? "", rank: m.rank ?? s.athletes.length, school: m.school ?? "" };
        s.athletes.push(a);
        changed = true;
      } else if (!force && (a.rev ?? 0) >= (m.rev ?? 0)) continue;
      if (m.retired) {
        if (!this.ownerOf(a.id)) {
          s.athletes = s.athletes.filter((x) => x.id !== m.id);
          delete s.waivers[m.id];
          for (const t of s.teams) t.queue = t.queue.filter((id) => id !== m.id);
          changed = true;
        }
        continue;
      }
      const owner = this.ownerOf(a.id);
      const prevCode = posCode(a);
      const nextCode = posCode(m);
      if (owner && prevCode !== nextCode) {
        const prev = { positions: a.positions, flex: a.flex };
        a.positions = [...m.positions];
        a.flex = m.flex;
        const lineup = this.solve(this.rosterOf(owner), owner.lineup);
        if (lineup) owner.lineup = lineup;
        else {
          s.audit.push({ id: uid(), at: Date.now(), actorId: "master", actorName: "Main League", action: "athlete.position", detail: `${a.name} is now ${nextCode}; ${owner.teamName}'s lineup couldn't be re-arranged automatically` });
        }
        a.positions = prev.positions;
        a.flex = prev.flex;
        this.notify(`${m.name}: new position`, `${m.name} is now listed as ${POSITION_CODES[nextCode]?.label ?? nextCode}. Check your lineup.`, "player", [owner.id], true, { key: `pos:${a.id}:${m.rev}`, link: { type: "player", id: a.id } });
      }
      const prevStatus: AthStatus = a.status ?? "active";
      const nextStatus: AthStatus = m.status ?? "active";
      if (owner && prevStatus !== nextStatus) {
        this.notify(`${m.name}: ${STATUS_LABEL[nextStatus]}`, nextStatus === "active" ? `${m.name} has been cleared and is Active.` : `${m.name} is now listed as ${STATUS_LABEL[nextStatus]}.${nextStatus === "IR" || nextStatus === "O" ? " You can move them to your IR spot." : ""}`, "player", [owner.id], true, { key: `status:${a.id}:${m.rev}`, link: { type: "player", id: a.id } });
      }
      if (prevStatus !== nextStatus) this.tx("status", null, `${m.name} is now listed as ${STATUS_LABEL[nextStatus]}`, [a.id]);
      a.name = m.name;
      a.school = m.school ?? "";
      a.gender = m.gender;
      a.positions = [...m.positions];
      a.flex = m.flex;
      a.note = m.note ?? "";
      a.status = nextStatus;
      a.rev = m.rev;
      a.masterPhoto = true;
      if (m.photoAt) a.photoAt = m.photoAt;
      else delete a.photoAt;
      a.crop = m.crop ?? null;
      changed = true;
    }
    if (maxRev !== (s.poolRev ?? 0)) { s.poolRev = maxRev; changed = true; }
    if (changed) s.adp = resolveAdp(s.adpNames, s.athletes, s.adp);
    return changed;
  }

  /** Sends a player change to the master database (the Directory checks the Main League commissioner) and applies it here. */
  private async forwardMaster(user: User, action: Record<string, unknown>): Promise<void> {
    const s = this.require();
    if (!this.isMain()) throw new ForbiddenError("Player info is set by the Main League. Only the Main League commissioner can change it.");
    const r = await this.env.DO.fetch(new Request("https://internal/master-action", {
      method: "POST", headers: DIR_HEADERS, body: JSON.stringify({ user, action, via: s.id }),
    }));
    const out = (await r.json().catch(() => ({}))) as { error?: string; athlete?: MasterAthlete };
    if (r.status === 403) throw new ForbiddenError(out.error ?? "Only the Main League commissioner can change player info.");
    if (!r.ok) throw new ActionError(out.error ?? "The player couldn't be saved. Nothing was changed.");
    if (out.athlete) this.applyMaster([out.athlete], true);
    this.audit(user, `master.${String(action.type ?? "")}`, `${out.athlete?.name ?? ""}`);
  }

  /** Undoes the draft for this league only. Members, team names, settings, master players and other leagues are untouched. */
  private async resetDraft(user: User): Promise<void> {
    const s = this.require();
    this.assertCommish(user);
    if (s.phase === "predraft" && s.draft.picks.length === 0) throw new ActionError("The draft hasn't started yet.");
    const at = Date.now();
    await this.ctx.storage.put(`backup:draftreset:${at}`, JSON.parse(JSON.stringify(s)) as State);
    const order = s.draftOrderAtStart && s.draftOrderAtStart.length === s.teams.length ? [...s.draftOrderAtStart] : [...s.draft.order];
    for (const [i, t] of s.teams.entries()) {
      t.lineup = emptyLineup();
      t.queue = [];
      t.waiverPriority = i + 1;
      t.faab = this.st().faabBudget;
      t.addsThisWeek = 0;
    }
    s.draft = { order, picks: [], status: "pending", deadline: null, pausedRemaining: null, startedAt: null };
    s.phase = "predraft";
    s.week = 1;
    s.schedule = [];
    s.bracket = null;
    s.lineupSnapshots = {};
    s.locks = {};
    s.waivers = {};
    delete s.shape;
    delete s.draftOrderAtStart;
    s.settings.draftAt = null;
    for (const c of s.claims) if (c.status === "pending") { c.status = "cancelled"; c.reason = "Draft reset"; c.resolvedAt = at; }
    for (const t of s.trades) if (t.status === "pending" || t.status === "review") { t.status = "cancelled"; t.resolvedAt = at; }
    this.audit(user, "draft.reset", `Draft reset by ${user.name}. Backup: backup:draftreset:${at}`);
    this.tx("commish", null, "The commissioner reset the draft. The league is back to pre-draft.");
    this.notify("Draft reset", "The commissioner reset the draft. Rosters are cleared and a new draft will be scheduled.", "draft", null, true, { key: `draft:reset:${at}`, link: { type: "draft" } });
  }

  /** Old v1 leagues are reset: members kept, everything else starts over at pre-draft. */
  private migrate(raw: Record<string, unknown>): State {
    const oldTeams = Array.isArray(raw.teams) ? (raw.teams as Record<string, unknown>[]) : [];
    const now = Date.now();
    const s: State = {
      schema: 2,
      id: String(raw.id ?? ""),
      name: String(raw.name ?? "Track League"),
      code: String(raw.code ?? ""),
      commissionerId: String(raw.commissionerId ?? ""),
      createdAt: Number(raw.createdAt ?? now),
      season: new Date().getFullYear(),
      phase: "predraft",
      settings: defaultSettings(),
      teams: oldTeams.map((t, i) => this.blankTeam(String(t.id ?? uid()), String(t.ownerName ?? "Coach"), String(t.teamName ?? "Team"), i)),
      athletes: seedAthletes(),
      draft: { order: [], picks: [], status: "pending", deadline: null, pausedRemaining: null, startedAt: null },
      week: 1,
      schedule: [],
      bracket: null,
      lineupSnapshots: {},
      waivers: {},
      claims: [],
      trades: [],
      transactions: [{ id: uid(), kind: "commish", teamId: null, text: "League reset for the new TrackDraft rules", at: now, athleteIds: [] }],
      notifications: [],
      version: Number(raw.version ?? 0) + 1,
      meets: [], mappings: {}, unmatched: [], eventMap: {}, audit: [], adpNames: [...DEFAULT_ADP], adp: [],
      reads: {}, noteKeys: [], notedPoints: {},
    };
    s.adp = resolveAdp(s.adpNames, s.athletes);
    return s;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const s = this.require();
        const uidParam = url.searchParams.get("userId") ?? "";
        if (!this.isMember(uidParam)) return new Response("forbidden", { status: 403 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ userId: uidParam });
        server.send(JSON.stringify({ type: "hello", version: s.version, serverNow: Date.now() }));
        return new Response(null, { status: 101, webSocket: client });
      }

      if (request.method === "GET" && url.pathname === "/avatar") {
        const teamId = url.searchParams.get("teamId") ?? "";
        const b64 = await this.ctx.storage.get<string>(`avatar:${teamId}`);
        if (!b64) return new Response("not found", { status: 404 });
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
      }

      if (request.method === "POST" && url.pathname === "/avatar") {
        const body = (await request.json()) as { user: User; image?: string };
        if (!this.isMember(body.user.id)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        const image = (body.image ?? "").replace(/^data:image\/\w+;base64,/, "");
        if (image.length < 100 || image.length > 450_000 || !/^[A-Za-z0-9+/=]+$/.test(image)) {
          throw new ActionError("That photo couldn't be used. Try a smaller image.");
        }
        const own = this.myTeam(body.user);
        await this.ctx.storage.put(`avatar:${own.id}`, image);
        own.avatarAt = Date.now();
        await this.save();
        return Response.json(this.view(body.user.id));
      }

      if (request.method === "GET" && url.pathname === "/athlete-photo") {
        const s = this.require();
        const a = s.athletes.find((x) => x.id === (url.searchParams.get("athleteId") ?? ""));
        if (!a?.photoAt) return new Response("not found", { status: 404 });
        if (a.masterPhoto) {
          // Headshots live in the master player database: one photo for every league.
          const r = await this.dirGet(`/master-photo?id=${encodeURIComponent(a.id)}&v=${encodeURIComponent(url.searchParams.get("v") ?? "")}`);
          return new Response(r.body, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": r.headers.get("Cache-Control") ?? "no-store" } });
        }
        const b64 = await this.ctx.storage.get<string>(`aphoto:${a.id}:${a.photoAt}`);
        if (!b64) return new Response("not found", { status: 404 });
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        // Versioned URLs are immutable; an unversioned or outdated request always gets the current photo, uncached.
        const current = url.searchParams.get("v") === String(a.photoAt);
        return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": current ? "public, max-age=31536000, immutable" : "no-store", ETag: `"${a.id}-${a.photoAt}"` } });
      }

      if (request.method === "POST" && url.pathname === "/athlete-photo") {
        const body = (await request.json()) as { user: User; athleteId?: string; image?: string; remove?: boolean; expectAt?: number | null };
        if (!this.isMember(body.user.id)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        if (this.require().commissionerId !== body.user.id) return Response.json({ error: "Only the commissioner can change player photos." }, { status: 403 });
        await this.ensureGlobal();
        if (!this.isMain()) return Response.json({ error: "Player photos are set by the Main League. Only the Main League commissioner can change them." }, { status: 403 });
        const b = body as Record<string, unknown>;
        await this.forwardMaster(body.user, body.remove === true
          ? { type: "removePhoto", athleteId: body.athleteId, expectAt: body.expectAt }
          : { type: "setPhoto", athleteId: body.athleteId, image: body.image ?? "", expectAt: body.expectAt, crop: b.crop });
        await this.save();
        return Response.json(this.view(body.user.id));
      }

      // MARK: Master player database plumbing (called by the Directory only)

      if (request.method === "GET" && url.pathname === "/pool-export") {
        const s = this.require();
        await this.ctx.storage.put(`backup:pool:${Date.now()}`, s.athletes);
        const edits: Record<string, number> = {};
        for (const x of s.audit) {
          if (!x.action.startsWith("athlete.")) continue;
          for (const a of s.athletes) if (x.detail.startsWith(`${a.name}:`)) edits[a.id] = Math.max(edits[a.id] ?? 0, x.at);
        }
        return Response.json({
          id: s.id, name: s.name, createdAt: s.createdAt, edits,
          athletes: s.athletes.map((a) => ({ id: a.id, name: a.name, gender: a.gender, positions: a.positions, flex: a.flex, note: a.note, school: a.school ?? "", rank: a.rank, status: a.status ?? "active", photoAt: a.photoAt ?? null })),
        });
      }

      if (request.method === "POST" && url.pathname === "/pool-apply") {
        const body = (await request.json()) as { athletes?: MasterAthlete[]; force?: boolean };
        this.require();
        if (this.applyMaster(body.athletes ?? [], body.force === true)) await this.save();
        return Response.json({ ok: true, rev: this.state?.poolRev ?? 0 });
      }

      // MARK: Global configuration plumbing (called by the Directory only)

      if (request.method === "GET" && url.pathname === "/projection-history") {
        // Directory only: verified, dated, individual results + PBs, used by other leagues for projections only.
        const s = this.require();
        const demo = new Set(s.meets.filter((m) => m.isDemo).map((m) => m.id));
        const results = [...this.results.values()]
          .filter((r) => r.status === "OK" && !r.relay && r.provisional !== true && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !(r.meetId && demo.has(r.meetId)) && r.athleteIds.length === 1)
          .map((r) => ({
            id: r.id, key: r.key, week: 0, meet: r.meet, date: r.date, event: r.event, gender: r.gender, athleteIds: r.athleteIds, relay: false,
            mark: r.mark, place: r.place, heatPlace: r.heatPlace, seeded: r.seeded, status: r.status, best: r.best, enteredAt: r.enteredAt, source: r.source,
            ...(r.season !== undefined ? { season: r.season } : {}), ...(r.section ? { section: r.section } : {}), ...(r.seedMark ? { seedMark: r.seedMark } : {}),
          }));
        const lib = this.isMain() ? await this.projectionLibrary() : [];
        const seen = new Set(results.map((r) => `${r.athleteIds[0]}|${keyOf(r.event)}|${r.date}|${r.mark}`));
        const extra = lib.filter((r) => !seen.has(`${r.athleteIds[0]}|${keyOf(r.event)}|${r.date}|${r.mark}`));
        return Response.json({ at: Date.now(), results: [...results, ...extra], pbs: this.scoring.pbs, library: extra.length });
      }

      if (request.method === "GET" && url.pathname === "/global-whois") {
        const s = this.require();
        return Response.json({ commissionerId: s.commissionerId, leagueId: s.id, code: s.code });
      }

      if (request.method === "GET" && url.pathname === "/global-seed") {
        const s = this.require();
        const feeds: Record<string, RawFeed> = {};
        for (const m of s.meets) {
          if (m.provider !== "MANUAL") continue;
          const f = await this.ctx.storage.get<RawFeed>(`feed:${m.id}`);
          if (f) feeds[m.id] = f;
        }
        return Response.json({
          commissionerId: s.commissionerId, settings: s.settings, standards: this.scoring.standards,
          performance: this.scoring.performance.filter((p) => p.toWeek === undefined || p.toWeek === null),
          meets: s.meets.filter((m) => !m.archived).map(({ entries: _e, entryEvents: _ee, eventsStarted: _es, demo: _d, schedule: _s, ...m }) => m), feeds,
        });
      }

      if (request.method === "POST" && url.pathname === "/global-apply") {
        const body = (await request.json()) as { config: GlobalConfig; sync?: string[] };
        const s = this.require();
        await this.applyGlobal(body.config, body.sync ?? []);
        return Response.json({ ok: true, version: this.global?.version ?? 0, phase: s.phase, shapePending: this.shapePending() });
      }

      if (request.method === "POST" && url.pathname === "/meet-lab") {
        const body = (await request.json()) as { user: User; action: Record<string, unknown> };
        await this.ensureGlobal();
        if (!this.isMain()) return Response.json({ error: "The Meet Test Lab is in the Main League." }, { status: 403 });
        if (this.require().commissionerId !== body.user.id) return Response.json({ error: "Only the Main League commissioner can use the Meet Test Lab." }, { status: 403 });
        if (body.action.history === true) return Response.json({ runs: (await this.ctx.storage.get("lab:runs")) ?? [] });
        return Response.json(await this.labRun(body.action, true));
      }

      if (request.method === "POST" && url.pathname === "/meet-test") {
        const body = (await request.json()) as { user: User; action: Record<string, unknown> };
        if (!this.isMember(body.user.id)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        this.assertCommish(body.user);
        await this.ensureGlobal();
        // Read-only and isolated; `lab` adds the full evidence view and acceptance checks.
        const out = await this.labRun(body.action, body.action.lab === true);
        // The Main League's Test Connection result is part of the global meet record.
        const meetId = String(body.action.meetId ?? "");
        if (meetId && this.isMain() && this.global?.meets.some((m) => m.id === meetId)) {
          await this.forwardGlobal(body.user, { type: "setMeetTest", meetId, test: out }).catch((e: unknown) => console.warn("store meet test failed", String(e)));
        }
        return Response.json(out);
      }

      if (request.method === "POST" && url.pathname === "/init") {
        const body = (await request.json()) as { id: string; name: string; code: string; user: User; teamName: string; settings?: Record<string, unknown> };
        if (this.state) return Response.json({ error: "exists" }, { status: 409 });
        this.state = this.createState(body);
        this.scoring.heatRuleFromWeek = 1;
        await this.saveScoring();
        await this.save();
        // New leagues use the current global setup and see every global meet immediately.
        this.global = null;
        await this.ensureGlobal();
        return Response.json(this.view(body.user.id));
      }

      if (request.method === "POST" && url.pathname === "/join") {
        const body = (await request.json()) as { user: User; teamName: string };
        const s = this.require();
        const co = s.teams.find((t) => t.coManagerId === body.user.id);
        if (co) throw new ActionError(`You're already co-managing ${co.teamName} in this league.`);
        if (!s.teams.some((t) => t.id === body.user.id)) {
          if (s.phase !== "predraft") throw new ActionError("This league has already drafted.");
          if (s.teams.length >= this.st().maxTeams) throw new ActionError("This league is full.");
          const team = this.blankTeam(body.user.id, body.user.name, body.teamName, s.teams.length);
          s.teams.push(team);
          this.tx("join", team.id, `${team.teamName} joined the league`);
          this.notify("New manager joined", `${team.ownerName} joined as ${team.teamName}. ${s.teams.length} teams now.`, "join", this.others(team.id), true, { key: `join:${team.id}`, link: { type: "activity" } });
          await this.save();
        }
        return Response.json(this.view(body.user.id));
      }

      // MARK: League deletion (commissioner only, atomic)

      if (request.method === "POST" && url.pathname === "/delete") {
        const body = (await request.json()) as { user: User; confirmName?: string };
        return Response.json(await this.deleteLeague(body.user, String(body.confirmName ?? "")));
      }

      // MARK: Co-manager invites (the invitee isn't a member yet)

      if (request.method === "POST" && (url.pathname === "/co-preview" || url.pathname === "/co-accept" || url.pathname === "/co-decline")) {
        const body = (await request.json()) as { user: User; teamId: string; code: string };
        return Response.json(await this.coInviteRoute(url.pathname.slice(1), body.user, body.teamId, body.code));
      }

      const userId = url.searchParams.get("userId") ?? "";

      if (url.pathname === "/mock") {
        if (request.method === "GET") {
          if (!this.isMember(userId)) throw new ForbiddenError("Not a member of this league.");
          return Response.json(this.mockView(userId, url.searchParams.get("mockId") ?? ""));
        }
        const body = (await request.json()) as { user: User; op: Record<string, unknown> };
        if (!this.isMember(body.user.id)) throw new ForbiddenError("Not a member of this league.");
        return Response.json(await this.mockOp(body.user, body.op ?? {}));
      }

      if (request.method === "GET" && url.pathname === "/projections") {
        if (!this.isMember(userId)) throw new ForbiddenError("Not a member of this league.");
        const s = this.require();
        await this.ensureSharedHistory();
        const week = clampInt(url.searchParams.get("week"), 1, 60, s.week);
        const athleteId = url.searchParams.get("athleteId") ?? "";
        if (url.searchParams.get("rankings") === "1") return Response.json(await this.waiverRankings(week));
        if (athleteId && url.searchParams.get("explain") === "1") {
          return Response.json({ ...(this.athleteProjection(athleteId, week) as Record<string, unknown>), explanation: await this.explainProjection(athleteId, week) });
        }
        if (url.searchParams.get("accuracy") === "1") return Response.json({ accuracy: (await this.ctx.storage.get("proj:accuracy")) ?? null, modelVersion: MODEL_VERSION });
        return Response.json(athleteId ? this.athleteProjection(athleteId, week) : await this.weekProjections(week));
      }

      if (request.method === "GET" && url.pathname === "/state") {
        const s = this.require();
        if (!this.isMember(userId)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        await this.ensureGlobal();
        this.syncPool();
        this.ctx.waitUntil(this.ensureSharedHistory());
        const since = Number(url.searchParams.get("since") ?? "-1");
        if (since === s.version) return Response.json({ unchanged: true, version: s.version });
        return Response.json(this.view(userId));
      }

      if (request.method === "GET" && url.pathname === "/breakdown") {
        if (!this.isMember(userId)) throw new ForbiddenError("Not a member of this league.");
        await this.ensureGlobal();
        const s = this.require();
        const week = clampInt(url.searchParams.get("week"), 1, 60, s.week);
        const teamId = url.searchParams.get("teamId") ?? "";
        return Response.json(teamId ? this.teamBreakdown(teamId, week) : this.weekBreakdown(url.searchParams.get("athleteId") ?? "", week));
      }

      if (request.method === "POST" && url.pathname === "/tools") {
        const body = (await request.json()) as { user: User; action: Record<string, unknown> };
        if (!this.isMember(body.user.id)) throw new ForbiddenError("Not a member of this league.");
        if (this.require().commissionerId !== body.user.id) throw new ForbiddenError("Only the commissioner can do that.");
        await this.ensureGlobal();
        const op = String(body.action.op ?? "");
        if (op === "reconcile") return Response.json(await this.reconcile(body.action.plant === true));
        if (op === "health") return Response.json(await this.health());
        if (op === "notelog") return Response.json({ log: (await this.ctx.storage.get<NoteLog[]>("notelog")) ?? [], duplicatesBlocked: this.require().noteDupes ?? 0 });
        if (op === "pushAudit") {
          const s = this.require();
          const people = [
            ...s.teams.map((t) => ({ id: t.id, name: t.ownerName, team: t.teamName, role: "manager" })),
            ...s.teams.filter((t) => !!t.coManagerId).map((t) => ({ id: t.coManagerId as string, name: `${t.ownerName}'s co-manager`, team: t.teamName, role: "co-manager" })),
          ].slice(0, 30);
          const members = await Promise.all(people.map(async (p) => {
            const u = await viewUser(this.env, p.id);
            return { ...p, linked: u.found, devices: u.subscriptions.length, subscribed: u.subscriptions.filter((x) => x.subscribed).length, problem: userProblem(u), subscriptions: u.subscriptions };
          }));
          return Response.json({ members, at: Date.now() });
        }
        if (op === "snapshots") return Response.json({ snapshots: ((await this.ctx.storage.get<SnapMeta[]>("snaps")) ?? []).slice().reverse() });
        // Read-only labs on real results. Nothing here changes scoring, relays or the schedule.
        if (op === "seedLab") return Response.json(this.runLab("seed"));
        if (op === "relayLab") return Response.json(this.runLab("relay"));
        if (op === "backtest") return Response.json(await this.runBacktestStored());
        if (op === "schedule") return Response.json(this.scheduleView(Number(body.action.seed ?? 0) || null));
        // Read-only: any commissioner may preview; only the Main League commissioner can publish (checked by the Directory).
        if (op === "preview") return Response.json({ ...(await this.previewChange(body.action)), canPublish: this.isMain() });
        if (ADMIN_OPS.has(op)) return Response.json(await this.adminOp(body.user, op, body.action));
        if (op === "versions") {
          const g = this.global;
          return Response.json({
            current: g ? versionsAt(g, Number.POSITIVE_INFINITY) : null,
            rules: (g?.rules ?? []).map((r) => ({ version: r.version ?? 0, since: r.since, by: r.by ?? null })).reverse(),
            tables: (g?.tableLog ?? []).slice().reverse(),
            audit: (g?.audit ?? []).filter((a) => a.action.startsWith("scoring") || a.action.startsWith("performance") || a.action.startsWith("standard")).slice(-60).reverse(),
          });
        }
        throw new ActionError("Unknown tool.");
      }

      if (request.method === "GET" && url.pathname === "/athlete") {
        if (!this.isMember(userId)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        const athleteId = url.searchParams.get("athleteId") ?? "";
        this.athlete(athleteId);
        return Response.json({ athleteId, lines: this.lines.filter((l) => l.athleteId === athleteId) });
      }

      if (request.method === "GET" && url.pathname === "/dbstatus") {
        if (!this.isMember(userId) || this.require().commissionerId !== userId) return Response.json({ error: "Only the commissioner can do that." }, { status: 403 });
        try {
          return Response.json({ enabled: this.db.enabled, counts: await this.db.counts(this.require().id) });
        } catch (e) {
          return Response.json({ enabled: this.db.enabled, error: String(e).slice(0, 200) });
        }
      }

      if (request.method === "GET" && url.pathname === "/matchup") {
        if (!this.isMember(userId)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        const s = this.require();
        const week = clampInt(url.searchParams.get("week"), 1, 60, s.week);
        const focus = url.searchParams.get("teamId") || this.teamOf(userId)?.id || userId;
        this.team(focus);
        const m = s.schedule.find((x) => x.week === week && (x.homeId === focus || x.awayId === focus));
        const teamIds = [focus, ...(m ? [m.homeId, m.awayId].filter((x): x is string => !!x && x !== focus) : [])];
        const ids = new Set<string>();
        for (const t of teamIds) {
          const lineup = this.lineupFor(t, week);
          for (const slot of SLOT_IDS) if (lineup[slot]) ids.add(lineup[slot] as string);
        }
        return Response.json({ week, teamIds, athleteIds: [...ids], lines: this.lines.filter((l) => l.week === week && ids.has(l.athleteId)) });
      }

      if (request.method === "GET" && url.pathname === "/scoring") {
        if (!this.isMember(userId)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        await this.ensureGlobal();
        const g = this.global;
        return Response.json({
          ...this.globalView(userId),
          rules: g ? currentRules(g) : DEFAULT_SCORING,
          results: [...this.results.values()].sort((a, b) => b.enteredAt - a.enteredAt),
          records: this.scoring.records,
          fumbles: this.scoring.fumbles,
          standards: g ? liveRows(g.standards) : this.scoring.standards,
          pbs: this.scoring.pbs,
          events: EVENT_NAMES,
          performance: g ? liveRows(g.performance) : this.scoring.performance,
          performanceEvents: PERFORMANCE_EVENTS.map((e) => ({ event: e, measurement: measurementTypeOf(e) })),
          heatRuleFromWeek: this.scoring.heatRuleFromWeek ?? 0,
          history: this.history,
        });
      }

      if (request.method === "POST" && url.pathname === "/preview") {
        const body = (await request.json()) as { user: User; action: Record<string, unknown> };
        if (!this.isMember(body.user.id)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        this.assertCommish(body.user);
        const candidate = this.buildResult(body.action);
        const others = [...this.results.values()].filter((r) => r.id !== candidate.id && r.key !== candidate.key);
        const all = computeLines(this.scoringInput([...others, candidate]));
        const lines = all.filter((l) => l.sourceId === candidate.id);
        return Response.json({ lines, total: round2(lines.reduce((a, l) => a + l.points, 0)) });
      }

      if (request.method === "POST" && url.pathname === "/action") {
        const body = (await request.json()) as { user: User; action: Record<string, unknown> };
        if (!this.isMember(body.user.id)) return Response.json({ error: "Not a member of this league." }, { status: 403 });
        await this.ensureGlobal();
        const s = this.require();
        // Duplicate protection: a retried request (same id) is applied once; the retry just gets the current state.
        const rid = typeof body.action.requestId === "string" ? body.action.requestId.slice(0, 64) : "";
        if (rid && (s.requestIds ?? []).includes(`${body.user.id}:${rid}`)) return Response.json(this.view(body.user.id));
        // All-or-nothing: if the action fails midway, the league goes back to exactly how it was.
        const snapshot = JSON.stringify(s);
        const scoringSnapshot = JSON.stringify(this.scoring);
        try {
          await this.handleAction(body.user, body.action);
        } catch (e) {
          this.state = JSON.parse(snapshot) as State;
          // Records, fumbles and marks on file are stored separately: roll them back too, then rebuild the lines.
          if (JSON.stringify(this.scoring) !== scoringSnapshot) {
            this.scoring = JSON.parse(scoringSnapshot) as Scoring;
            await this.saveScoring();
          }
          this.recompute();
          throw e;
        }
        if (rid) s.requestIds = [...(s.requestIds ?? []), `${body.user.id}:${rid}`].slice(-300);
        await this.save();
        return Response.json(this.view(body.user.id));
      }

      return Response.json({ error: "not found" }, { status: 404 });
    } catch (err) {
      if (err instanceof ActionError) return Response.json({ error: err.message }, { status: 400 });
      if (err instanceof NotFoundError) return Response.json({ error: err.message, deleted: true }, { status: 404 });
      if (err instanceof ForbiddenError) return Response.json({ error: err.message }, { status: 403 });
      console.error("league error", err);
      return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (text === "ping") {
      try { ws.send(JSON.stringify({ type: "pong", version: this.state?.version ?? 0 })); } catch { /* closed */ }
    }
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch { /* already closed */ }
  }

  /** Tells every connected manager the league changed; clients pull the new state immediately. */
  private broadcast(): void {
    const s = this.state;
    if (!s) return;
    const msg = JSON.stringify({ type: "state", version: s.version, serverNow: Date.now() });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* peer gone */ }
    }
  }

  async onAlarm(_info: { scheduledTime: number; retryCount: number; isRetry: boolean }): Promise<void> {
    const s = this.state;
    if (!s) return;
    const now = Date.now();
    let changed = false;
    for (const m of s.meets) {
      if (m.scope === "global" || m.archived || !m.polling || m.nextSyncAt === null || m.nextSyncAt > now + 1000) continue;
      if (m.startedAt !== null && now - m.startedAt > MAX_LIVE_MS) {
        m.polling = false;
        m.nextSyncAt = null;
        this.notify("Live scoring paused", `${m.name} has been live for 16 hours. Mark it final or restart live scoring.`, "commish", [s.commissionerId]);
        changed = true;
        continue;
      }
      try {
        await this.syncMeet(m.id);
      } catch (e) {
        console.error("meet sync failed", String(e));
        m.nextSyncAt = now + POLL_MS * 2;
      }
      changed = true;
    }
    if (s.phase === "predraft" && s.settings.draftAt !== null && s.settings.draftAt <= now + 1000 && s.teams.length >= 2) {
      this.startDraft();
      changed = true;
    }
    if (s.phase === "drafting" && s.draft.status === "live" && s.draft.deadline !== null && s.draft.deadline <= now + 750) {
      const teamId = this.teamOnClock();
      const athleteId = teamId ? this.autoPickFor(teamId) : null;
      if (teamId && athleteId) {
        this.makePick(teamId, athleteId, true);
        changed = true;
      }
    }
    if (s.phase === "season" && Object.values(s.waivers).some((t) => t <= now + 1000)) {
      // A waiver run saves as one unit. If it fails, nothing from it is kept and the alarm retries it.
      const snap = JSON.stringify(s);
      try {
        this.processWaivers(now + 1000);
        changed = true;
      } catch (e) {
        console.error("waiver run failed, rolled back", String(e));
        this.state = JSON.parse(snap) as State;
        await this.env.DO.setAlarm("League", this.state.id, now + 60_000);
        return;
      }
    }
    if (s.phase === "season" && s.advanceAt != null && s.advanceAt <= now + 1000) {
      this.advanceWeek();
      changed = true;
    }
    if (this.refreshLocks(now)) changed = true;
    const locked = this.lockedIds();
    for (const t of s.trades) {
      if (t.status === "review" && t.reviewUntil !== null && t.reviewUntil <= now + 1000) {
        // A trade can't move a player who is locked into this week's meet; it waits until the week is final.
        if ([...t.give, ...t.get].some((id) => locked.has(id))) { t.reviewUntil = now + 30 * 60_000; changed = true; continue; }
        this.completeTrade(t);
        changed = true;
      }
    }
    await this.runMockClocks(now);
    if (changed) await this.save();
    else await this.scheduleAlarm();
  }

  // MARK: - Persistence

  private require(): State {
    if (!this.state) throw new NotFoundError("This league no longer exists.");
    return this.state;
  }

  /** Primary managers and co-managers are members. */
  private isMember(userId: string): boolean {
    return !!userId && this.require().teams.some((t) => t.id === userId || (!!t.coManagerId && t.coManagerId === userId));
  }

  /** The team this user manages (as primary or co-manager). */
  private teamOf(userId: string): Team | undefined {
    return this.require().teams.find((t) => t.id === userId || (!!t.coManagerId && t.coManagerId === userId));
  }

  /**
   * THE permission check for managing a team (lineup, add/drop, bench/IR, waivers, trades, draft picks, team photo).
   * True for the team's primary manager and its one co-manager. Nobody else, commissioner included.
   */
  private canManageTeam(userId: string, teamId: string): boolean {
    const t = this.require().teams.find((x) => x.id === teamId);
    return !!t && !!userId && (t.id === userId || (!!t.coManagerId && t.coManagerId === userId));
  }

  /** The caller's team, after the permission check. */
  private myTeam(user: User): Team {
    const t = this.teamOf(user.id);
    if (!t || !this.canManageTeam(user.id, t.id)) throw new ActionError("You don't manage a team in this league.");
    return t;
  }

  /** Team ids → every account that should hear about that team (primary + co-manager). */
  private expandTargets(teamIds: string[]): string[] {
    const s = this.require();
    const out = new Set<string>();
    for (const id of teamIds) {
      out.add(id);
      const co = s.teams.find((t) => t.id === id)?.coManagerId;
      if (co) out.add(co);
    }
    return [...out];
  }

  private async save(): Promise<void> {
    const s = this.require();
    s.version += 1;
    if (s.transactions.length > 300) s.transactions = s.transactions.slice(-300);
    if (s.claims.length > 200) s.claims = s.claims.filter((c) => c.status === "pending").concat(s.claims.filter((c) => c.status !== "pending").slice(-120));
    if (s.audit.length > 400) s.audit = s.audit.slice(-400);
    const openUnmatched = s.unmatched.filter((u) => u.status === "open");
    if (s.unmatched.length > 400) s.unmatched = openUnmatched.concat(s.unmatched.filter((u) => u.status !== "open").slice(-150));
    if (s.notifications.length > 300) s.notifications = s.notifications.slice(-300);
    await this.ctx.storage.put("state", s);
    this.flushPushes();
    await this.scheduleAlarm();
    this.broadcast();
    if (this.scoringDirty) {
      this.scoringDirty = false;
      this.mirrorScoring();
    }
  }

  private async saveScoring(): Promise<void> {
    await this.ctx.storage.put("scoring", this.scoring);
  }

  private async scheduleAlarm(): Promise<void> {
    const s = this.require();
    const times: number[] = [];
    if (s.phase === "predraft" && s.settings.draftAt !== null) times.push(s.settings.draftAt);
    if (s.phase === "drafting" && s.draft.status === "live" && s.draft.deadline !== null) times.push(s.draft.deadline);
    if (s.phase === "season") times.push(...Object.values(s.waivers));
    if (s.phase === "season" && s.advanceAt != null) times.push(s.advanceAt);
    for (const t of s.trades) if (t.status === "review" && t.reviewUntil !== null) times.push(t.reviewUntil);
    for (const m of s.meets) if (m.scope !== "global" && !m.archived && m.polling && m.nextSyncAt !== null) times.push(m.nextSyncAt);
    const nextLock = this.nextLockAt();
    if (nextLock !== null) times.push(nextLock);
    for (const mk of this.mocks.values()) if (mk.status === "live" && mk.deadline !== null) times.push(mk.deadline);
    if (times.length === 0) {
      await this.env.DO.deleteAlarm("League", s.id).catch(() => undefined);
      return;
    }
    await this.env.DO.setAlarm("League", s.id, Math.max(Date.now() + 500, Math.min(...times)));
  }

  /** The one input every scoring run uses (lines, previews, demo meets). */
  private scoringInput(results: Result[]): ScoringInput {
    const g = this.global;
    const since = this.state?.globalSince ?? Number.POSITIVE_INFINITY;
    const closed = new Map<number, number>();
    const closedAt = (week: number): number => {
      let t = closed.get(week);
      if (t === undefined) { t = this.weekClosedAt(week); closed.set(week, t); }
      return t;
    };
    // Weeks that closed before this league switched to the global setup keep the league's own old rules and rows.
    // Every other week uses the Main League's global rules that were in force when the week closed (or now, if open).
    const useGlobal = (week: number): boolean => !!g && closedAt(week) >= since;
    const sandbox = !this.isMain() ? this.state?.sandboxRules ?? [] : [];
    const sandboxAt = (week: number): { version: number; rules: ScoringConfig } | null => {
      const t = closedAt(week);
      let hit: { version: number; rules: ScoringConfig } | null = null;
      for (const v of sandbox) if (v.since <= t) hit = v;
      return hit;
    };
    const rulesFor = (week: number): ScoringConfig => sandboxAt(week)?.rules ?? (useGlobal(week) && g ? rulesAt(g, closedAt(week)) : DEFAULT_SCORING);
    const ruleActive = (row: RuleWindow, week: number): boolean =>
      row.scope === "global" ? useGlobal(week) && timeActive(row, closedAt(week)) : !useGlobal(week) && weekWindow(row, week);
    return {
      results, records: this.scoring.records, fumbles: this.scoring.fumbles,
      standards: [...this.scoring.standards, ...(g?.standards ?? [])], pbs: this.scoring.pbs,
      performance: [...this.scoring.performance, ...(g?.performance ?? [])], legacyHeatBeforeWeek: this.scoring.heatRuleFromWeek ?? 0,
      season: this.state?.season ?? new Date().getFullYear(), rulesFor, ruleActive,
      versionFor: (week: number): string => {
        const sb = sandboxAt(week);
        if (sb) return `TEST-LEAGUE sandbox scoring v${sb.version}`;
        return useGlobal(week) && g ? versionsAt(g, closedAt(week)).label : "league rules (pre-global)";
      },
    };
  }

  /** When a week's matchups were finalized (0 = long ago / unknown). Infinity while the week is still open. */
  private weekClosedAt(week: number): number {
    const s = this.state;
    if (!s) return Number.POSITIVE_INFINITY;
    const games = s.schedule.filter((m) => m.week === week);
    if (games.length > 0 && games.every((m) => m.final)) return Math.max(0, ...games.map((m) => m.finalAt ?? 0));
    if (games.length === 0 && s.phase !== "predraft" && s.phase !== "drafting" && week < s.week) return 0;
    return Number.POSITIVE_INFINITY;
  }

  // MARK: - Global (Main League) configuration

  private isMain(): boolean {
    return !!this.global?.mainLeagueId && this.global.mainLeagueId === this.state?.id;
  }

  /** Effective settings: global game rules + this league's own draft time, draft order and size. */
  private st(): Settings {
    const s = this.require();
    const g = this.global?.settings;
    const out: Settings = { ...s.settings };
    if (g) for (const k of GLOBAL_SETTING_KEYS) (out as Record<string, unknown>)[k] = g[k];
    // A league that already drafted keeps its season shape until its next draft.
    if (s.phase !== "predraft" && s.shape) Object.assign(out, s.shape);
    return out;
  }

  private shapePending(): boolean {
    const s = this.require();
    const g = this.global?.settings;
    if (!g || s.phase === "predraft" || !s.shape) return false;
    return SHAPE_KEYS.some((k) => s.shape?.[k] !== g[k]);
  }

  /**
   * The Main League's verified history, for PROJECTIONS ONLY (never real scoring). A league without its own results
   * (new league, preseason) still projects from last season. Refreshed every ~30 minutes.
   */
  private libraryCache: { at: number; hash: string; results: Result[] } | null = null;

  /** This league's own projection library (Main League: the shared list; test leagues: their own list, if any). */
  private async ensureLibrary(): Promise<void> {
    const c = this.libraryCache;
    if (c && Date.now() - c.at < 30 * 60_000) return;
    try {
      const own = this.isMain() || !!this.require().qaSandbox || (await this.ctx.storage.get<ProjMeet[]>("projmeets:list")) !== undefined;
      const results = own ? await this.projectionLibrary() : [];
      this.libraryCache = { at: Date.now(), hash: hash(JSON.stringify([results.length, results.map((r) => r.id).sort()])), results };
    } catch (e) {
      console.warn("projection library load failed", String(e));
    }
  }

  private async ensureSharedHistory(): Promise<void> {
    await this.ensureLibrary();
    if (this.isMain()) return;
    const sh = this.sharedHistory;
    if (sh && Date.now() - sh.fetchedAt < (sh.results.length > 0 ? 30 * 60_000 : 2 * 60_000)) return;
    try {
      const r = await this.dirGet("/projection-history");
      if (!r.ok) return;
      const d = (await r.json()) as { at: number; results: Result[]; pbs: Record<string, Record<string, string>> };
      this.sharedHistory = { fetchedAt: Date.now(), hash: hash(JSON.stringify([d.at, d.results.length, Object.keys(d.pbs).length])), results: d.results, pbs: d.pbs };
    } catch (e) {
      console.warn("shared history load failed", String(e));
    }
  }

  private dirGet(path: string): Promise<Response> {
    return this.env.DO.fetch(new Request(`https://internal${path}`, { headers: DIR_HEADERS }));
  }

  /** Makes sure the global config is loaded (from cache, else from the Directory). Refreshes a stale cache quietly. */
  private async ensureGlobal(): Promise<void> {
    const stale = Date.now() - this.globalFetchedAt > 5 * 60_000;
    if (this.global && !stale) return;
    const load = async (): Promise<void> => {
      try {
        const r = await this.dirGet("/global-config");
        if (!r.ok) return;
        const { config } = (await r.json()) as { config: GlobalConfig };
        this.globalFetchedAt = Date.now();
        if (this.state) await this.applyGlobal(config, []);
        else this.global = normalizeConfig(config);
      } catch (e) {
        console.warn("global config load failed", String(e));
      }
    };
    if (this.global) this.ctx.waitUntil(load());
    else await load();
  }

  /** Applies a pushed global config: meets, rules, shape. Idempotent; serialised so two pushes never interleave. */
  private applyGlobal(cfg: GlobalConfig, sync: string[]): Promise<void> {
    const run = this.applying.then(() => this.applyGlobalNow(cfg, sync));
    this.applying = run.catch(() => undefined);
    return run;
  }

  private async applyGlobalNow(raw: GlobalConfig, _sync: string[]): Promise<void> {
    const s = this.state;
    if (!s) return;
    // Without a Main League there is no global setup to switch to; the league keeps running as it is.
    if (!raw?.mainLeagueId) return;
    const cfg = normalizeConfig(raw);
    const prev = this.global;
    if (prev && prev.version > cfg.version) return;
    const now = Date.now();
    let changed = !prev || prev.version !== cfg.version;
    this.global = cfg;
    this.globalFetchedAt = now;
    await this.ctx.storage.put("global", cfg);
    if (s.globalSince === undefined) {
      s.globalSince = now;
      if (s.phase !== "predraft" && !s.shape) s.shape = { regularWeeks: s.settings.regularWeeks, playoffTeams: s.settings.playoffTeams, consolation: s.settings.consolation };
      this.tx("commish", null, this.isMain() ? "This is the Main League: its scoring, rules and meets now apply to every league" : "This league now uses the Main League's global scoring, rules and meets");
      changed = true;
    }
    const globalIds = new Set(cfg.meets.map((m) => m.id));
    // Old league-only meets keep their points but no longer run.
    for (const m of s.meets) {
      if (globalIds.has(m.id) || m.archived || m.testMeet) continue;
      if (m.scope === "global") continue;
      m.archived = true;
      m.polling = false;
      m.nextSyncAt = null;
      changed = true;
    }
    // Global meets removed by the Main League: their scores go with them.
    for (const m of [...s.meets]) {
      if (m.scope !== "global" || globalIds.has(m.id)) continue;
      for (const r of [...this.results.values()]) {
        if (r.meetId !== m.id) continue;
        this.results.delete(r.id);
        await this.ctx.storage.delete(`res:${r.id}`);
      }
      await this.ctx.storage.delete(`demo:${m.id}`);
      s.meets = s.meets.filter((x) => x.id !== m.id);
      s.unmatched = s.unmatched.filter((u) => u.meetId !== m.id || u.status !== "open");
      this.scoringDirty = true;
      changed = true;
    }
    let rescore = !prev || prev.scoringVersion !== cfg.scoringVersion;
    const toSync: { m: Meet; final: boolean }[] = [];
    for (const gm of cfg.meets) {
      let m = s.meets.find((x) => x.id === gm.id);
      if (!m) {
        m = { ...this.blankMeet(), id: gm.id };
        s.meets.push(m);
        changed = true;
      }
      const weekBefore = m.week;
      const statusBefore = m.status;
      // Already closed out here with the same final time (e.g. the Main League's own meets), or a league that hasn't
      // drafted yet: nothing to finalize, just score the data.
      // Meets finalized before this league switched to the global setup never close a week here retroactively.
      if (gm.status === "FINAL" && gm.finalAt !== null && ((m.status === "FINAL" && m.finalAt === gm.finalAt) || s.phase === "predraft" || s.phase === "drafting" || gm.finalAt < (s.globalSince ?? 0))) m.finalSeen = gm.finalAt;
      const before = JSON.stringify(GLOBAL_MEET_KEYS.map((k) => (m as unknown as Record<string, unknown>)[k]));
      for (const k of GLOBAL_MEET_KEYS) (m as unknown as Record<string, unknown>)[k] = (gm as unknown as Record<string, unknown>)[k];
      m.scope = "global";
      m.archived = false;
      if (before !== JSON.stringify(GLOBAL_MEET_KEYS.map((k) => (m as unknown as Record<string, unknown>)[k]))) changed = true;
      if (!m.isDemo && m.week !== weekBefore) {
        for (const r of this.results.values()) {
          if (r.meetId !== m.id || r.locked) continue;
          r.week = m.week;
          await this.ctx.storage.put(`res:${r.id}`, r);
        }
        rescore = true;
      }
      if (m.status === "LIVE" && statusBefore !== "LIVE" && !m.isDemo && !m.history && s.phase === "season") {
        if (s.advanceAt != null && m.week === s.week + 1) this.advanceWeek();
        this.notify(`${m.name} is LIVE`, "Live scoring is on. Your matchup updates automatically as results post.", "score", null, true, { key: `live:${m.id}:${m.startedAt}`, link: { type: "matchup", week: m.week } });
      }
      const sig = m.isDemo ? `demo:${m.syncCount}:${m.startedAt ?? 0}` : m.feedHash ?? (m.provider === "MANUAL" && m.status !== "UPCOMING" ? `manual:${m.lastSyncedAt ?? 0}` : null);
      const finalPending = m.status === "FINAL" && m.finalAt !== null && m.finalSeen !== m.finalAt;
      // Main League "Reprocess": rebuild this meet's results from the stored feed (replaces, never adds).
      const reprocess = !!m.reprocessAt && m.reprocessAt !== m.reprocessSeen;
      if (reprocess) { await this.snapshot(`Before reprocessing ${m.name}`); m.reprocessSeen = m.reprocessAt; m.seenFeed = null; this.rowHashes.delete(m.id); }
      if ((sig && sig !== m.seenFeed && m.status !== "UPCOMING") || finalPending || (reprocess && m.status !== "UPCOMING")) toSync.push({ m, final: finalPending });
    }
    if (this.resyncWaiverSchedule()) changed = true;
    if (rescore) {
      if (prev && prev.scoringVersion !== cfg.scoringVersion && this.results.size > 0) await this.snapshot(`Before scoring v${cfg.scoringVersion} (Main League change)`);
      this.recompute();
      if (s.phase === "season") this.refreshLocks(now);
      changed = true;
    }
    for (const { m, final } of toSync) {
      try {
        if (final) {
          await this.finalizeMeet(m, null);
          m.seenFeed = m.isDemo ? `demo:${m.syncCount}:${m.startedAt ?? 0}` : m.feedHash ?? `manual:${m.lastSyncedAt ?? 0}`;
        } else {
          const r = await this.syncMeet(m.id);
          if (!r.error) m.seenFeed = m.isDemo ? `demo:${m.syncCount}:${m.startedAt ?? 0}` : m.feedHash ?? `manual:${m.lastSyncedAt ?? 0}`;
        }
      } catch (e) {
        console.error("global meet sync failed", m.id, String(e));
      }
      changed = true;
    }
    if (changed) await this.save();
  }

  /** Sends a global change to the Directory (which checks the Main League commissioner) and applies the result here. */
  private async forwardGlobal(user: User, action: Record<string, unknown>): Promise<Record<string, unknown>> {
    const s = this.require();
    if (!this.isMain()) throw new ForbiddenError("This is set by the Main League. Only the Main League commissioner can change it.");
    const r = await this.env.DO.fetch(new Request("https://internal/global-action", {
      method: "POST", headers: DIR_HEADERS, body: JSON.stringify({ user, action, via: s.id }),
    }));
    const out = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status === 403) throw new ForbiddenError(String(out.error ?? "Only the Main League commissioner can change global settings."));
    if (!r.ok) throw new ActionError(String(out.error ?? "Something went wrong. Nothing was changed."));
    if (out.config) await this.applyGlobal(out.config as GlobalConfig, (out.sync as string[] | undefined) ?? []);
    return out;
  }

  private globalView(userId: string): Record<string, unknown> {
    const g = this.global;
    const s = this.require();
    return {
      isMainLeague: this.isMain(),
      mainLeagueCode: MAIN_LEAGUE_CODE,
      canEditGlobal: this.isMain() && userId === s.commissionerId,
      shapePending: this.shapePending(),
      global: g ? {
        version: g.version, scoringVersion: g.scoringVersion, updatedAt: g.updatedAt, updatedBy: g.updatedBy,
        rules: currentRules(g), settings: g.settings, roster: g.roster, live: g.live, notices: g.notices,
      } : null,
    };
  }


  private recompute(): void {
    const all = computeAll(this.scoringInput([...this.results.values()]));
    this.lines = all.lines;
    this.history = all.history;
    const h = hash(this.lines.map((l) => `${l.id}:${l.points}:${l.week}:${l.provisional ? 1 : 0}`).join("|"));
    if (h !== this.linesHash) {
      this.linesHash = h;
      this.scoringDirty = true;
    }
    const pts: Record<string, Record<string, number>> = {};
    for (const l of this.lines) {
      const byWeek = pts[l.athleteId] ?? {};
      byWeek[String(l.week)] = round2((byWeek[String(l.week)] ?? 0) + l.points);
      pts[l.athleteId] = byWeek;
    }
    this.pts = pts;
  }

  // MARK: - View

  private view(userId: string): unknown {
    const s = this.require();
    const records = this.records();
    const standings = this.standingsOrder(records);
    const commish = userId === s.commissionerId;
    const tid = this.teamOf(userId)?.id ?? userId;
    const role = tid === userId ? "primary" : "co";
    return {
      id: s.id, name: s.name, code: s.code, commissionerId: s.commissionerId, createdAt: s.createdAt, season: s.season,
      phase: s.phase, settings: this.st(), week: s.week, version: s.version,
      viewerId: userId, role,
      ...this.globalView(userId),
      globalVersion: this.global?.version ?? 0,
      locks: s.phase === "season" && s.advanceAt == null ? s.locks?.[String(s.week)] ?? {} : {},
      teams: s.teams.map((t) => {
        const r = records[t.id] ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, streak: "" };
        const manages = this.canManageTeam(userId, t.id);
        return {
          id: t.id, ownerName: t.ownerName, teamName: t.teamName, color: t.color, avatarAt: t.avatarAt ?? null,
          coManagerId: t.coManagerId ?? null, coManagerName: t.coManagerName ?? null,
          coInvite: manages && t.id === userId ? t.coInvite ?? null : null,
          lineup: t.lineup, roster: this.rosterOf(t), queue: manages ? t.queue : [],
          waiverPriority: t.waiverPriority, faab: t.faab, addsThisWeek: t.addsThisWeek, joinedAt: t.joinedAt,
          wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: round2(r.pointsFor), pointsAgainst: round2(r.pointsAgainst),
          streak: r.streak, rank: standings.indexOf(t.id) + 1,
        };
      }),
      standings,
      athletes: s.athletes.map((a) => ({ ...a, position: posCode(a), photo: a.photoAt ? `/leagues/${s.id}/athlete-photo/${a.id}?v=${a.photoAt}` : null })),
      draft: { ...s.draft, rounds: ROUNDS },
      schedule: s.schedule.map((m) => ({
        ...m,
        homeScore: this.matchScore(m, m.homeId),
        awayScore: m.awayId ? this.matchScore(m, m.awayId) : null,
      })),
      bracket: s.bracket,
      points: this.pts,
      lineupSnapshots: s.lineupSnapshots,
      waivers: s.waivers,
      claims: s.claims.filter((c) => c.teamId === tid).sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || (a.rank ?? 999) - (b.rank ?? 999) || a.createdAt - b.createdAt),
      nextWaiverRun: this.nextWaiverRun(),
      canEditPlayers: this.isMain() && userId === s.commissionerId,
      waiverPriorityOrder: [...s.teams].sort((a, b) => a.waiverPriority - b.waiverPriority).map((t) => t.id),
      // Offers stay private to the two teams; a trade under review is shown to whoever votes on it (league review) or the commissioner.
      trades: s.trades.filter((t) => t.fromId === tid || t.toId === tid || t.status === "accepted" || t.status === "vetoed"
        || (t.status === "review" && (this.st().tradeReview === "league" || commish))),
      transactions: this.transactionsFor(tid),
      notifications: this.notesFor(userId),
      rankings: this.rankings(),
      lastCompletedWeek: this.lastCompletedWeek(),
      nextWeekAt: s.phase === "season" ? s.advanceAt ?? null : null,
      lastWeekPoints: this.lastWeekPoints(),
      waiverOrder: this.waiverOrder(),
      slots: SLOT_IDS,
      totalWeeks: this.totalWeeks(),
      me: tid,
      serverNow: Date.now(),
      meets: s.meets.map(({ entries: _e, entryEvents: _ee, eventsStarted: _es, ...m }) => m),
      adp: this.adpOrder(),
      adpReview: commish ? s.adp : [],
      unmatched: commish ? s.unmatched.filter((u) => u.status === "open").slice(0, 200) : [],
      unmatchedCount: s.unmatched.filter((u) => u.status === "open").length,
      // "?" indicator for every member: a possible result for this player is waiting for commissioner review (no source details).
      reviewFlags: s.unmatched.filter((u) => u.status === "open" && u.kind === "athlete").reduce<Record<string, number>>((acc, u) => {
        for (const c of u.candidates.slice(0, 3)) acc[c] = (acc[c] ?? 0) + 1;
        return acc;
      }, {}),
      audit: commish ? s.audit.slice(-80).reverse() : [],
      eventMap: commish ? s.eventMap : {},
    };
  }

  private notesFor(userId: string): unknown[] {
    const s = this.require();
    const r = s.reads[userId] ?? { at: 0, ids: [] };
    const read = new Set(r.ids);
    const tid = this.teamOf(userId)?.id ?? userId;
    const isCo = tid !== userId;
    return s.notifications
      .filter((n) => n.targets === null || n.targets.includes(tid))
      .filter((n) => !(isCo && n.kind === "commish"))
      .slice(-120)
      .map((n) => ({
        id: n.id, at: n.at, title: n.title, body: n.body, kind: n.kind,
        category: n.category ?? League.categoryFor(n.kind), link: n.link ?? League.linkFor(n.kind),
        read: n.at <= r.at || read.has(n.id),
      }));
  }

  /** Every athlete by season fantasy points; ties broken by draft ranking, then name (same for every viewer). */
  private rankings(): string[] {
    const s = this.require();
    const adp = new Map(this.adpOrder().map((id, i) => [id, i]));
    return [...s.athletes]
      .sort((a, b) => this.seasonPoints(b.id) - this.seasonPoints(a.id) || (adp.get(a.id) ?? 9999) - (adp.get(b.id) ?? 9999) || a.name.localeCompare(b.name))
      .map((a) => a.id);
  }

  /** Latest week whose matchups are all final (0 before any week is done). */
  private lastCompletedWeek(): number {
    const s = this.require();
    let last = 0;
    for (let w = 1; w <= s.week; w++) {
      const games = s.schedule.filter((m) => m.week === w);
      if (games.length > 0 && games.every((m) => m.final)) last = w;
    }
    return last;
  }

  /** Points each athlete scored in the last completed week, from finalized meets and commissioner-entered results only. */
  private lastWeekPoints(): Record<string, number> {
    const s = this.require();
    const week = this.lastCompletedWeek();
    const out: Record<string, number> = {};
    if (week === 0) return out;
    const finalMeets = new Set(s.meets.filter((m) => m.status === "FINAL" && !m.isDemo).map((m) => m.id));
    for (const l of this.lines) {
      if (l.week !== week || l.provisional) continue;
      if (l.meetId && !finalMeets.has(l.meetId)) continue;
      out[l.athleteId] = round2((out[l.athleteId] ?? 0) + l.points);
    }
    return out;
  }

  /** Waiver-wire order: last completed week's points (only positive scores move up), then draft ranking. */
  private waiverOrder(): string[] {
    const pts = this.lastWeekPoints();
    const adp = this.adpOrder();
    const idx = new Map(adp.map((id, i) => [id, i]));
    return [...adp].sort((a, b) => {
      const pa = Math.max(0, pts[a] ?? 0);
      const pb = Math.max(0, pts[b] ?? 0);
      return pb - pa || (idx.get(a) ?? 0) - (idx.get(b) ?? 0);
    });
  }

  /** Athlete ids in draft-room order: the commissioner's ADP list first, then everyone else by pool rank. */
  private adpOrder(): string[] {
    const s = this.require();
    const listed = s.adp.map((e) => e.athleteId).filter((x): x is string => !!x && !!this.maybeAthlete(x));
    const seen = new Set(listed);
    return listed.concat([...s.athletes].sort((a, b) => a.rank - b.rank).map((a) => a.id).filter((id) => !seen.has(id)));
  }

  private createState(body: { id: string; name: string; code: string; user: User; teamName: string; settings?: Record<string, unknown> }): State {
    const now = Date.now();
    const name = (body.name ?? "").trim().slice(0, 40) || "Track League";
    const s: State = {
      schema: 2,
      id: body.id, name, code: body.code, commissionerId: body.user.id, createdAt: now,
      season: new Date().getFullYear(),
      phase: "predraft",
      settings: defaultSettings(),
      teams: [this.blankTeam(body.user.id, body.user.name, body.teamName, 0)],
      athletes: seedAthletes(),
      draft: { order: [], picks: [], status: "pending", deadline: null, pausedRemaining: null, startedAt: null },
      week: 1, schedule: [], bracket: null, lineupSnapshots: {}, waivers: {}, claims: [], trades: [],
      transactions: [{ id: uid(), kind: "commish", teamId: body.user.id, text: `${body.user.name} created ${name}`, at: now, athleteIds: [] }],
      notifications: [],
      version: 0,
      meets: [], mappings: {}, unmatched: [], eventMap: {}, audit: [], adpNames: [...DEFAULT_ADP], adp: [],
      reads: {}, noteKeys: [], notedPoints: {},
    };
    s.adp = resolveAdp(s.adpNames, s.athletes);
    this.state = s;
    this.applySettings(body.settings ?? {});
    return s;
  }

  private cleanTeamName(teamName: string, owner: string): string {
    return (teamName ?? "").trim().slice(0, 28) || `${owner.split(" ")[0] ?? "Team"}'s Squad`;
  }

  private blankTeam(id: string, ownerName: string, teamName: string, index: number): Team {
    return {
      id,
      ownerName: (ownerName ?? "").trim().slice(0, 32) || "Coach",
      teamName: this.cleanTeamName(teamName, ownerName),
      color: COLORS[index % COLORS.length] ?? "#20C463",
      lineup: emptyLineup(), queue: [], waiverPriority: index + 1, faab: 100, addsThisWeek: 0, joinedAt: Date.now(),
    };
  }

  // MARK: - Lookups

  private team(id: string): Team {
    const t = this.require().teams.find((x) => x.id === id);
    if (!t) throw new ActionError("Team not found.");
    return t;
  }

  private athlete(id: string): Athlete {
    const a = this.require().athletes.find((x) => x.id === id);
    if (!a) throw new ActionError("Athlete not found.");
    return a;
  }

  private maybeAthlete(id: string): Athlete | undefined {
    return this.require().athletes.find((x) => x.id === id);
  }

  private rosterOf(team: Team): string[] {
    return SLOT_IDS.map((id) => team.lineup[id]).filter((x): x is string => typeof x === "string");
  }

  private ownerOf(athleteId: string): Team | undefined {
    return this.require().teams.find((t) => SLOT_IDS.some((id) => t.lineup[id] === athleteId));
  }

  private others(userId: string): string[] {
    return this.require().teams.map((t) => t.id).filter((id) => id !== userId);
  }

  private allIds(): string[] {
    return this.require().teams.map((t) => t.id);
  }

  private tx(kind: string, teamId: string | null, text: string, athleteIds: string[] = [], extra: { otherId?: string | null; status?: Tx["status"] } = {}): void {
    this.require().transactions.push({ id: uid(), kind, teamId, text, at: Date.now(), athleteIds, ...extra });
  }

  /**
   * Transactions as one viewer may see them (server-enforced privacy). Every entry is a completed, league-public move
   * (adds, drops, processed waivers, accepted/vetoed trades, commissioner actions). Pending claims, bids and offers
   * live in `claims`/`trades`, which are filtered to the teams involved. Each entry is flagged `mine` for My Moves.
   */
  private transactionsFor(tid: string): unknown[] {
    const s = this.require();
    const done = s.trades.filter((t) => t.status === "accepted" || t.status === "vetoed");
    return s.transactions.map((x) => {
      let other = x.otherId ?? null;
      if (x.kind === "trade" && other === null) {
        const ids = new Set(x.athleteIds);
        const t = done.find((d) => d.fromId === x.teamId && [...d.give, ...d.get].every((id) => ids.has(id)));
        other = t?.toId ?? null;
      }
      const status = x.status ?? (x.kind === "trade" && /vetoed/i.test(x.text) ? "vetoed" : "completed");
      return { ...x, otherId: other, status, mine: x.teamId === tid || other === tid };
    });
  }

  private nameOf(id: string): string {
    return this.maybeAthlete(id)?.name ?? "Unknown athlete";
  }

  private names(ids: string[]): string {
    return ids.map((id) => this.nameOf(id)).join(", ") || "nothing";
  }

  // MARK: - Notifications

  private pendingPushes: Push[] = [];

  private static categoryFor(kind: string): NoteCategory {
    switch (kind) {
      case "draft": return "draft";
      case "trade": return "trades";
      case "waiver": return "waivers";
      case "score": case "result": case "lock": return "live";
      case "player": return "player";
      default: return "league";
    }
  }

  private static linkFor(kind: string): NoteLink {
    switch (kind) {
      case "draft": return { type: "draft" };
      case "trade": return { type: "trades" };
      case "waiver": return { type: "transactions" };
      case "score": case "result": case "lock": return { type: "matchup" };
      case "playoffs": return { type: "playoffs" };
      default: return { type: "activity" };
    }
  }

  /**
   * Creates exactly one Notification Center entry per real event (dedupe `key`), and queues a push for the targets.
   * Pushes are only sent after the state is saved, filtered by each account's notification preferences.
   */
  private notify(title: string, body: string, kind: string, targets: string[] | null, push = true, opts: NoteOpts = {}): void {
    const s = this.require();
    if (opts.key) {
      if (s.noteKeys.includes(opts.key)) { s.noteDupes = (s.noteDupes ?? 0) + 1; return; }
      s.noteKeys.push(opts.key);
      if (s.noteKeys.length > 1500) s.noteKeys = s.noteKeys.slice(-1000);
    }
    const members = new Set(this.allIds());
    const list = targets === null ? null : [...new Set(targets)].filter((id) => members.has(id));
    if (list !== null && list.length === 0) return;
    const category = opts.category ?? League.categoryFor(kind);
    const link = opts.link ?? League.linkFor(kind);
    const note: Note = { id: uid(), at: Date.now(), title, body, kind, targets: list, category, link, key: opts.key };
    s.notifications.push(note);
    if (!push) return;
    // Team-targeted pushes also reach that team's co-manager (commissioner-only notes never do).
    // Game-wide notification rules (Main League): a switched-off category stays in the Notification Center but isn't pushed.
    if (this.global?.notices[category] === false && kind !== "commish") return;
    const pushTo = kind === "commish" ? (list ?? this.allIds()) : this.expandTargets(list ?? this.allIds());
    this.pendingPushes.push({
      title, body, category, targets: pushTo,
      data: { leagueId: s.id, kind, category, noteId: note.id, eventKey: opts.key ?? null, link: link.type, linkId: link.id ?? null, week: link.week ?? null },
    });
  }

  /** Deterministic UUID-shaped delivery key: a retried push for the same notification is never delivered twice. */
  private static deliveryKey(leagueId: string, noteId: string, part: number): string {
    const h = (x: string): string => hash(x).replace(/[^0-9a-z]/g, "").padEnd(12, "0");
    const hex = [...`${h(`${leagueId}|${noteId}|${part}`)}${h(`${noteId}|${part}|${leagueId}`)}${h(`${part}|${leagueId}`)}`]
      .map((c) => (parseInt(c, 36) % 16).toString(16)).join("").slice(0, 32).padEnd(32, "0");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  /** Push delivery audit: one row per logical notification (newest first, capped). */
  private async logDelivery(rows: NoteLog[]): Promise<void> {
    if (rows.length === 0) return;
    const cur = (await this.ctx.storage.get<NoteLog[]>("notelog")) ?? [];
    const byKey = new Map(cur.map((r) => [r.deliveryKey, r]));
    for (const r of rows) byKey.set(r.deliveryKey, { ...(byKey.get(r.deliveryKey) ?? {}), ...r });
    const next = [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 400);
    await this.ctx.storage.put("notelog", next);
  }

  private flushPushes(): void {
    const pushes = this.pendingPushes;
    this.pendingPushes = [];
    const appId = this.env.ONESIGNAL_APP_ID;
    const key = this.env.ONESIGNAL_REST_API_KEY;
    if (!appId || !key || pushes.length === 0) return;
    const s = this.require();
    const ids = [...new Set(pushes.flatMap((p) => p.targets))];
    this.ctx.waitUntil((async () => {
      let prefs: Record<string, Record<string, boolean>> = {};
      try {
        const r = await this.env.DO.fetch(new Request("https://internal/prefs-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Rork-DO-Class": "Directory", "X-Rork-DO-Id": "global" },
          body: JSON.stringify({ ids }),
        }));
        prefs = ((await r.json()) as { prefs: typeof prefs }).prefs ?? {};
      } catch (e) {
        console.warn("prefs lookup failed", String(e));
      }
      const members = new Set([...this.allIds(), ...s.teams.map((t) => t.coManagerId).filter((x): x is string => !!x)]);
      const log: NoteLog[] = [];
      for (const p of pushes) {
        // Never leak a league's notification outside it: recipients must be members of this league.
        const to = p.targets.filter((id) => members.has(id) && prefs[id]?.[p.category] !== false);
        const noteId = String(p.data.noteId ?? uid());
        const deliveryKey = League.deliveryKey(s.id, noteId, 0);
        const row: NoteLog = {
          deliveryKey, noteId, eventKey: (p.data.eventKey as string | null) ?? null, category: p.category, leagueId: s.id, title: p.title,
          recipients: to.length, createdAt: Date.now(), attempts: 0, status: "queued", error: null, link: String(p.data.link ?? "none"), oneSignalId: null,
        };
        if (to.length === 0) { row.status = "skipped"; row.error = "Every recipient turned this category off."; log.push(row); continue; }
        for (let attempt = 1; attempt <= 3; attempt++) {
          row.attempts = attempt;
          try {
            const sent = await sendPush(this.env, {
              include_aliases: { external_id: to },
              headings: { en: p.title }, subtitle: { en: s.name }, contents: { en: p.body },
              data: p.data, thread_id: s.id, idempotency_key: deliveryKey, ios_sound: "default",
            });
            if (sent.notificationId) {
              row.oneSignalId = sent.notificationId;
              row.status = "sent";
              row.error = sent.invalid ? `Some recipients skipped: ${sent.invalid}`.slice(0, 300) : null;
              break;
            }
            if (sent.httpStatus >= 200 && sent.httpStatus < 300) {
              row.status = "no-devices";
              row.error = (sent.error ?? "No subscribed devices").slice(0, 300);
              break;
            }
            row.status = "failed";
            row.error = (sent.error ?? `HTTP ${sent.httpStatus}`).slice(0, 300);
            if (sent.httpStatus > 0 && sent.httpStatus < 500 && sent.httpStatus !== 429) break;
          } catch (e) {
            row.status = "failed";
            row.error = String(e).slice(0, 200);
          }
          await new Promise((res) => setTimeout(res, attempt * 1500));
        }
        if (row.status === "failed") console.warn("onesignal push failed", row.error);
        // Explain "no device" per recipient with OneSignal's own subscription state instead of a generic label.
        if (row.status === "no-devices") {
          const reasons: string[] = [];
          for (const id of to.slice(0, 8)) {
            const u = await viewUser(this.env, id);
            const who = s.teams.find((t) => t.id === id || t.coManagerId === id)?.ownerName ?? id.slice(0, 8);
            reasons.push(`${who}: ${userProblem(u) ?? "has a subscribed device (OneSignal may still be linking it)"}`);
          }
          row.reasons = reasons;
        }
        log.push(row);
      }
      // APNs outcome: OneSignal reports how many tokens APNs accepted, rejected (invalid) or errored.
      for (const row of log.filter((r) => r.status === "sent" && r.oneSignalId)) {
        const st = await waitForStats(this.env, row.oneSignalId as string, 2, 2500);
        const v = statsVerdict(st);
        row.apns = st ? { successful: st.successful, failed: st.failed, errored: st.errored, received: st.received } : null;
        if (v.status === "delivered") row.status = "delivered";
        if (v.status === "failed") { row.status = "failed"; row.error = v.text.slice(0, 300); }
        if (st && st.failed > 0) {
          // APNs rejected some tokens: delete those dead subscriptions so they stop failing.
          const p = pushes.find((x) => String(x.data.noteId ?? "") === row.noteId);
          let removed = 0;
          for (const id of (p?.targets ?? []).filter((x) => members.has(x)).slice(0, 12)) {
            const gone = await removeStale(this.env, await viewUser(this.env, id), null);
            removed += gone.length;
            if (gone.length) await this.env.DO.fetch(new Request("https://internal/push-device-remove", { method: "POST", headers: { "Content-Type": "application/json", "X-Rork-DO-Class": "Directory", "X-Rork-DO-Id": "global" }, body: JSON.stringify({ subIds: gone }) })).catch(() => null);
          }
          row.staleRemoved = removed;
        }
      }
      await this.logDelivery(log).catch((e: unknown) => console.warn("notelog failed", String(e)));
    })());
  }

  private liveActivityId(week: number, teamId: string): string {
    return `m-${this.require().id.slice(0, 8)}-${week}-${teamId.slice(0, 12)}`;
  }

  private pushLiveActivities(week: number, end: boolean): void {
    const appId = this.env.ONESIGNAL_APP_ID;
    const key = this.env.ONESIGNAL_REST_API_KEY;
    if (!appId || !key) return;
    for (const { side, content } of this.liveActivityContent(week, end)) {
      const payload: Record<string, unknown> = { event: end ? "end" : "update", event_updates: content, name: `Week ${week} matchup` };
      if (end) payload.dismissal_date = Math.floor(Date.now() / 1000) + 4 * 3600;
      this.ctx.waitUntil(
        fetch(`https://api.onesignal.com/apps/${appId}/live_activities/${this.liveActivityId(week, side)}/notifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
          body: JSON.stringify(payload),
        })
          .then(async (r) => { if (!r.ok && r.status !== 404) console.warn("live activity update failed", r.status, await r.text()); })
          .catch((e: unknown) => console.warn("live activity error", String(e))),
      );
    }
  }

  /** Live Activity content for every team in a week (the exact payload the lock screen receives). */
  private liveActivityContent(week: number, end: boolean): { side: string; content: Record<string, unknown> }[] {
    const s = this.require();
    const outList: { side: string; content: Record<string, unknown> }[] = [];
    // Projected finals (actual + what's still to come). Projections never change real scores; display only.
    let teams: Record<string, { projected: number }> = {};
    try {
      teams = (this.computeWeek(week).teams ?? {}) as Record<string, { projected: number }>;
    } catch (e) {
      console.warn("live activity projections failed", String(e));
    }
    for (const m of s.schedule.filter((x) => x.week === week)) {
      for (const side of [m.homeId, m.awayId]) {
        if (!side) continue;
        const opp = side === m.homeId ? m.awayId : m.homeId;
        const myScore = this.teamWeekScore(side, week);
        const oppScore = opp ? this.teamWeekScore(opp, week) : 0;
        const leader = this.weekLeader(side, week);
        const myProj = end ? myScore : round2(myScore + (teams[side]?.projected ?? 0));
        const oppProj = end ? oppScore : opp ? round2(oppScore + (teams[opp]?.projected ?? 0)) : 0;
        const content = {
          myScore, oppScore, myProj, oppProj, leagueName: s.name.slice(0, 40),
          myLeader: leader ? `${leader.name} ${leader.points}` : "No points yet",
          status: end ? "FINAL" : "LIVE",
          detail: end
            ? myScore > oppScore ? "Victory" : myScore < oppScore ? "Defeat" : "Tie"
            : myScore > oppScore ? `Up ${round2(myScore - oppScore)}` : myScore < oppScore ? `Down ${round2(oppScore - myScore)}` : "Tied",
        };
        outList.push({ side, content });
      }
    }
    return outList;
  }

  // MARK: - Scores & standings

  private athleteWeek(athleteId: string, week: number): number {
    return this.pts[athleteId]?.[String(week)] ?? 0;
  }

  private lineupFor(teamId: string, week: number): Record<SlotId, string | null> {
    const s = this.require();
    const snap = s.lineupSnapshots[String(week)]?.[teamId];
    if (snap) return snap;
    if (week >= s.week) return this.team(teamId).lineup;
    return emptyLineup();
  }

  private teamWeekScore(teamId: string, week: number): number {
    const lineup = this.lineupFor(teamId, week);
    let total = 0;
    for (const slot of STARTERS) {
      const aid = lineup[slot];
      if (aid) total += this.athleteWeek(aid, week);
    }
    return round2(total);
  }

  /** A matchup side's score: frozen at finalization, otherwise live from the engine. */
  private matchScore(m: Matchup, teamId: string): number {
    if (m.final) {
      const frozen = teamId === m.homeId ? m.homeFinal : teamId === m.awayId ? m.awayFinal : null;
      if (typeof frozen === "number") return frozen;
    }
    return this.teamWeekScore(teamId, m.week);
  }

  private weekLeader(teamId: string, week: number): { name: string; points: number } | null {
    const lineup = this.lineupFor(teamId, week);
    let best: { name: string; points: number } | null = null;
    for (const slot of STARTERS) {
      const aid = lineup[slot];
      if (!aid) continue;
      const p = this.athleteWeek(aid, week);
      if (p > 0 && (!best || p > best.points)) best = { name: this.nameOf(aid).split(" ")[0] ?? "", points: p };
    }
    return best;
  }

  private seasonPoints(athleteId: string): number {
    return Object.values(this.pts[athleteId] ?? {}).reduce((a, b) => a + b, 0);
  }

  /** W-L-T, PF/PA and streak are always derived from finalized regular-season matchups + live scores. */
  private records(): Record<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; streak: string }> {
    const s = this.require();
    const out: Record<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; streak: string; hist: string[] }> = {};
    for (const t of s.teams) out[t.id] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, streak: "", hist: [] };
    const finals = s.schedule.filter((m) => m.final && m.kind === "regular").sort((a, b) => a.week - b.week);
    for (const m of finals) {
      const home = out[m.homeId];
      if (!home) continue;
      const hs = this.matchScore(m, m.homeId);
      home.pointsFor += hs;
      if (!m.awayId) continue;
      const away = out[m.awayId];
      if (!away) continue;
      const as = this.matchScore(m, m.awayId);
      away.pointsFor += as;
      home.pointsAgainst += as;
      away.pointsAgainst += hs;
      if (hs > as) { home.wins++; away.losses++; home.hist.push("W"); away.hist.push("L"); }
      else if (hs < as) { away.wins++; home.losses++; home.hist.push("L"); away.hist.push("W"); }
      else { home.ties++; away.ties++; home.hist.push("T"); away.hist.push("T"); }
    }
    for (const r of Object.values(out)) {
      const last = r.hist[r.hist.length - 1];
      if (!last) continue;
      let n = 0;
      for (let i = r.hist.length - 1; i >= 0 && r.hist[i] === last; i--) n++;
      r.streak = `${last}${n}`;
    }
    return out;
  }

  private h2h(a: string, b: string): number {
    let diff = 0;
    for (const m of this.require().schedule) {
      if (!m.final || m.kind !== "regular" || !m.awayId) continue;
      if (!((m.homeId === a && m.awayId === b) || (m.homeId === b && m.awayId === a))) continue;
      const sa = this.matchScore(m, a);
      const sb = this.matchScore(m, b);
      diff += sa > sb ? 1 : sa < sb ? -1 : 0;
    }
    return diff;
  }

  private standingsOrder(records: ReturnType<League["records"]>): string[] {
    const s = this.require();
    const pct = (id: string): number => {
      const r = records[id];
      if (!r) return 0;
      const g = r.wins + r.losses + r.ties;
      return g === 0 ? 0 : (r.wins + r.ties * 0.5) / g;
    };
    return s.teams
      .map((t) => t.id)
      .sort((a, b) => {
        const d = pct(b) - pct(a);
        if (Math.abs(d) > 1e-9) return d;
        if (this.st().tiebreaker === "h2h") {
          const h = this.h2h(b, a);
          if (h !== 0) return h;
        }
        return (records[b]?.pointsFor ?? 0) - (records[a]?.pointsFor ?? 0);
      });
  }

  // MARK: - Lineups

  /** Statuses allowed in the IR spot come from the global roster rules (default: IR or Out). */
  private isIrStatus(a: Athlete): boolean {
    const r = this.global?.roster;
    if (r && !r.irSlot) return false;
    const allowed = r?.irStatuses ?? ["IR", "O"];
    return !!a.status && a.status !== "active" && (allowed as string[]).includes(a.status);
  }

  /** The IR spot only takes athletes with an IR-eligible status; FLEX takes the globally allowed positions. */
  private eligible(a: Athlete, slot: SlotId): boolean {
    if (slot === "IR") return this.isIrStatus(a);
    if (slot === "FLEX") {
      const flex = this.global?.roster.flexPositions ?? ["SPR", "DIS", "FLD"];
      return a.positions.some((p) => flex.includes(p));
    }
    const pos = SLOT_POS[slot];
    return pos === undefined || a.positions.includes(pos);
  }

  /** An athlete sitting in the IR spot whose status went back to Active/Questionable blocks adds and claims. */
  private irProblem(team: Team): Athlete | null {
    const id = team.lineup.IR;
    const a = id ? this.maybeAthlete(id) : undefined;
    return a && !this.isIrStatus(a) ? a : null;
  }

  private assertIrClear(team: Team, dropId: string | null): void {
    const bad = this.irProblem(team);
    if (bad && bad.id !== dropId) throw new ActionError(`${bad.name} is no longer on IR. Move them out of the IR spot before adding players.`);
  }

  /**
   * Finds a slot for every athlete (backtracking over 7 slots). Keeps current slots when possible. IR is never filled
   * during the draft. `pinned` athletes (locked for this week's meet) never leave the slot they hold in `prefer`.
   */
  private solve(ids: string[], prefer: Record<SlotId, string | null>, allowIR = this.state?.phase !== "drafting", pinned: Set<string> = this.lockedIds()): Record<SlotId, string | null> | null {
    const keepIr = prefer.IR;
    const fits = (a: Athlete, slot: SlotId): boolean => (slot === "IR" ? allowIR && (this.isIrStatus(a) || a.id === keepIr) : this.eligible(a, slot));
    const base = emptyLineup();
    const free: string[] = [];
    for (const id of ids) {
      const cur = pinned.has(id) ? SLOT_IDS.find((x) => prefer[x] === id) : undefined;
      if (cur) base[cur] = id;
      else free.push(id);
    }
    ids = free;
    const lineup: Record<SlotId, string | null> = { ...base };
    const unplaced: string[] = [];
    for (const id of ids) {
      const cur = SLOT_IDS.find((s) => prefer[s] === id);
      if (cur && !lineup[cur] && fits(this.athlete(id), cur)) lineup[cur] = id;
      else unplaced.push(id);
    }
    const order: SlotId[] = allowIR ? ["SPR", "DIS", "FLD", "FLEX", "BN1", "BN2", "IR"] : ["SPR", "DIS", "FLD", "FLEX", "BN1", "BN2"];
    const place = (i: number): boolean => {
      if (i >= unplaced.length) return true;
      const id = unplaced[i] as string;
      const a = this.athlete(id);
      for (const slot of order) {
        if (lineup[slot] || !fits(a, slot)) continue;
        lineup[slot] = id;
        if (place(i + 1)) return true;
        lineup[slot] = null;
      }
      return false;
    };
    if (place(0)) return lineup;
    const all = [...ids].sort((x, y) => this.athlete(x).positions.length - this.athlete(y).positions.length);
    const fresh: Record<SlotId, string | null> = { ...base };
    const full = (i: number): boolean => {
      if (i >= all.length) return true;
      const id = all[i] as string;
      const a = this.athlete(id);
      for (const slot of order) {
        if (fresh[slot] || !fits(a, slot)) continue;
        fresh[slot] = id;
        if (full(i + 1)) return true;
        fresh[slot] = null;
      }
      return false;
    };
    return full(0) ? fresh : null;
  }

  private setRoster(team: Team, ids: string[], errorPrefix: string): void {
    if (ids.length > SLOT_IDS.length) throw new ActionError(`${errorPrefix}: roster would be over ${SLOT_IDS.length} athletes.`);
    const next = this.solve(ids, team.lineup);
    if (!next) throw new ActionError(`${errorPrefix}: there's no roster spot that fits. Sprinter, Distance and Field spots only take that position, and IR only takes players listed IR or Out.`);
    team.lineup = next;
  }

  private canHold(team: Team, ids: string[]): boolean {
    return ids.length <= SLOT_IDS.length && this.solve(ids, team.lineup) !== null;
  }

  private failTradesInvolving(athleteIds: string[], exceptId?: string): void {
    const s = this.require();
    for (const t of s.trades) {
      if ((t.status !== "pending" && t.status !== "review") || t.id === exceptId) continue;
      if ([...t.give, ...t.get].some((a) => athleteIds.includes(a))) {
        t.status = "failed";
        t.resolvedAt = Date.now();
        this.notify("Trade failed", `Your trade (${this.names(t.give)} for ${this.names(t.get)}) was cancelled because one of its athletes changed teams.`, "trade", [t.fromId, t.toId], true, { key: `trade:${t.id}:failed` });
      }
    }
    for (const c of s.claims) {
      if (c.status === "pending" && c.dropId && athleteIds.includes(c.dropId)) {
        c.status = "cancelled";
        c.resolvedAt = Date.now();
        c.reason = "Drop athlete left your roster";
      }
    }
  }

  private assertUnlocked(): void {
    const s = this.require();
    if (s.lineupSnapshots[String(s.week)]) throw new ActionError(`Lineups are locked for week ${s.week}.`);
  }

  private lockWeek(week: number, reason = "Lineups are locked until next week."): void {
    const s = this.require();
    if (s.lineupSnapshots[String(week)]) return;
    s.lineupSnapshots[String(week)] = Object.fromEntries(s.teams.map((t) => [t.id, { ...t.lineup }]));
    this.notify(`Week ${week} lineups locked`, reason, "lock", null, false, { key: `lock:${week}` });
  }

  // MARK: - Per-player locks

  private weekLocks(week: number): Record<string, Lock> {
    const s = this.require();
    s.locks ??= {};
    return (s.locks[String(week)] ??= {});
  }

  /** When each athlete's first event this week starts (published start time, or the first posted result as fallback). */
  private lockCandidates(now: number): Map<string, { at: number; event: string; meetId: string; reason: "start" | "result" } | { pendingAt: number }> {
    const s = this.require();
    const out = new Map<string, { at: number; event: string; meetId: string; reason: "start" | "result" } | { pendingAt: number }>();
    for (const m of s.meets) {
      if (m.isDemo || m.archived || m.week !== s.week) continue;
      const sched = new Map((m.schedule ?? []).map((e) => [e.id, e]));
      for (const [aid, evIds] of Object.entries(m.entries ?? {})) {
        for (const id of evIds) {
          const slot = sched.get(id);
          const cands: { at: number; reason: "start" | "result" }[] = [];
          if (slot?.startAt != null) {
            if (slot.startAt <= now) cands.push({ at: slot.startAt, reason: "start" });
            else {
              const cur = out.get(aid);
              if (!cur || ("pendingAt" in cur && slot.startAt < cur.pendingAt)) out.set(aid, { pendingAt: slot.startAt });
            }
          }
          const first = m.eventsStarted?.[id];
          if (first !== undefined) cands.push({ at: first, reason: "result" });
          for (const c of cands) {
            const cur = out.get(aid);
            if (!cur || "pendingAt" in cur || c.at < cur.at) out.set(aid, { at: c.at, event: slot?.event ?? slot?.name ?? id, meetId: m.id, reason: c.reason });
          }
        }
      }
    }
    return out;
  }

  /**
   * Persists a lock for every athlete whose event has started, recording the spot they hold right now. Runs before
   * every roster action, every sync and on the alarm, so the recorded spot is always the spot held at event start.
   */
  private refreshLocks(now = Date.now()): boolean {
    const s = this.require();
    if (s.phase !== "season" || s.lineupSnapshots[String(s.week)]) return false;
    const locks = this.weekLocks(s.week);
    let added = false;
    for (const [aid, c] of this.lockCandidates(now)) {
      if (locks[aid] || "pendingAt" in c || !this.maybeAthlete(aid)) continue;
      const owner = this.ownerOf(aid) ?? null;
      locks[aid] = { at: c.at, event: c.event, meetId: c.meetId, teamId: owner?.id ?? null, slot: owner ? SLOT_IDS.find((x) => owner.lineup[x] === aid) ?? null : null, reason: c.reason };
      added = true;
    }
    return added;
  }

  /** Athletes locked for the current week (evaluated now, server time). */
  private lockedIds(): Set<string> {
    const s = this.state;
    if (!s || s.phase !== "season") return new Set();
    // The week is final (its result stays on screen until Monday): its lineups are frozen, so nobody is locked any more.
    if (s.advanceAt != null) return new Set();
    this.refreshLocks();
    return new Set(Object.keys(s.locks?.[String(s.week)] ?? {}));
  }

  /** Next scheduled event start that will lock someone (so the lock is saved and pushed on time). */
  private nextLockAt(): number | null {
    const s = this.state;
    if (!s || s.phase !== "season" || s.lineupSnapshots[String(s.week)]) return null;
    const locks = s.locks?.[String(s.week)] ?? {};
    let best: number | null = null;
    for (const [aid, c] of this.lockCandidates(Date.now())) {
      if (locks[aid] || !("pendingAt" in c)) continue;
      best = best === null ? c.pendingAt : Math.min(best, c.pendingAt);
    }
    return best;
  }

  private lockMessage(aid: string): string {
    const s = this.require();
    const l = s.locks?.[String(s.week)]?.[aid];
    const when = l ? new Date(l.at + this.st().tzOffsetMin * 60_000).toISOString().slice(11, 16) : "";
    return `${this.nameOf(aid)} is locked${l ? ` (${l.event} started ${when})` : ""}. Locked players can't be moved, benched, dropped, added or traded until the week is final.`;
  }

  private assertNotLocked(ids: (string | null | undefined)[]): void {
    const locked = this.lockedIds();
    const hit = ids.find((id): id is string => !!id && locked.has(id));
    if (hit) throw new ActionError(this.lockMessage(hit));
  }

  /** Open (non-demo, not final) meets for a week. */
  private openMeets(week: number): Meet[] {
    const s = this.require();
    // Throwaway test leagues run on rehearsal meets: the real global meets don't hold their weeks open.
    const rehearsal = !this.isMain() && s.meets.some((m) => m.testMeet && !m.history);
    return s.meets.filter((m) => !m.isDemo && !m.archived && !m.history && m.week === week && m.status !== "FINAL" && !(rehearsal && m.scope === "global"));
  }

  /**
   * Ends the current week, in order: lineups frozen, scores frozen on each matchup, winners decided, standings and
   * waiver order follow from those frozen results, then final notifications. Nothing after this changes the matchup.
   */
  private finishWeek(): void {
    const s = this.require();
    const week = s.week;
    const games = s.schedule.filter((x) => x.week === week);
    // Already finalized (the result is on display until Monday): never finalize twice.
    if (s.advanceAt != null || (games.length > 0 && games.every((g) => g.final))) return;
    this.lockWeek(week, "The week is final. Lineups and scores are locked.");
    const now = Date.now();
    for (const m of games) {
      m.homeFinal = this.teamWeekScore(m.homeId, week);
      m.awayFinal = m.awayId ? this.teamWeekScore(m.awayId, week) : null;
      m.finalAt = now;
      m.final = true;
    }
    for (const m of games) {
      if (!m.awayId) continue;
      const hs = m.homeFinal ?? 0;
      const as = m.awayFinal ?? 0;
      const line = (them: string, a: number, b: number): string => {
        const n = this.team(them).teamName;
        return a > b ? `You beat ${n} ${a}–${b}.` : a < b ? `${n} beat you ${b}–${a}.` : `You tied ${n} ${a}–${b}.`;
      };
      this.notify(hs > as ? `Week ${week}: you won` : hs < as ? `Week ${week}: you lost` : `Week ${week}: tie`, line(m.awayId, hs, as), "result", [m.homeId], true, { key: `final:${week}:${m.homeId}`, link: { type: "matchup", week } });
      this.notify(as > hs ? `Week ${week}: you won` : as < hs ? `Week ${week}: you lost` : `Week ${week}: tie`, line(m.homeId, as, hs), "result", [m.awayId], true, { key: `final:${week}:${m.awayId}`, link: { type: "matchup", week } });
    }
    this.snapshotProjections(week, "final");
    this.pushLiveActivities(week, true);
    this.tx("commish", null, `Week ${week} is final`);
    for (const t of s.teams) t.addsThisWeek = 0;
    if (week === this.st().regularWeeks) this.seedBracket();
    if (week > this.st().regularWeeks) this.advanceBracket(week);
    const champ = s.bracket?.championId ?? null;
    const done = week >= this.totalWeeks() || (s.bracket === null && week >= this.st().regularWeeks) || champ !== null;
    if (done) {
      s.phase = "complete";
      const winnerId = champ ?? this.standingsOrder(this.records())[0] ?? null;
      if (winnerId) {
        const w = this.team(winnerId);
        this.tx("commish", w.id, `🏆 ${w.teamName} are the ${s.season} league champions`);
        this.notify("Champion crowned", `${w.teamName} win the ${s.name} title!`, "playoffs", null);
      }
    } else {
      // Yahoo-style: the final result stays up until Monday 12:00 AM Eastern, then the next matchup activates.
      s.advanceAt = nextWeeklyRun(now, 1, 0);
      if (s.advanceAt <= now + 1000) this.advanceWeek();
    }
  }

  // MARK: - Draft

  private teamOnClock(): string | null {
    const s = this.require();
    const n = s.draft.picks.length;
    const count = s.draft.order.length;
    if (count === 0 || n >= count * ROUNDS) return null;
    const round = Math.floor(n / count);
    const idx = n % count;
    return (round % 2 === 0 ? s.draft.order[idx] : s.draft.order[count - 1 - idx]) ?? null;
  }

  private autoPickFor(teamId: string): string | null {
    const s = this.require();
    const team = this.team(teamId);
    const roster = this.rosterOf(team);
    const taken = new Set(s.teams.flatMap((t) => this.rosterOf(t)));
    const fits = (id: string): boolean => !taken.has(id) && this.canHold(team, [...roster, id]);
    const queued = team.queue.find((id) => this.maybeAthlete(id) && fits(id));
    if (queued) return queued;
    const available = this.adpOrder().filter((id) => !taken.has(id)).map((id) => this.athlete(id));
    const open = (["SPR", "DIS", "FLD"] as SlotId[]).filter((slot) => !team.lineup[slot]);
    const needed = available.find((a) => open.some((slot) => this.eligible(a, slot)) && fits(a.id));
    return (needed ?? available.find((a) => fits(a.id)))?.id ?? null;
  }

  private startDraft(): void {
    const s = this.require();
    if (s.teams.length < 2) throw new ActionError("You need at least 2 teams to draft.");
    if (s.teams.length * ROUNDS > s.athletes.length) throw new ActionError("Not enough athletes for every team.");
    const ids = new Set(s.teams.map((t) => t.id));
    if (s.settings.draftOrderMode === "random" || s.draft.order.length !== ids.size || !s.draft.order.every((id) => ids.has(id))) {
      const order = [...ids];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j] as string, order[i] as string];
      }
      s.draft.order = order;
    }
    // The season shape is fixed for this season when the draft starts; later global shape changes apply next season.
    const eff = this.st();
    s.shape = { regularWeeks: eff.regularWeeks, playoffTeams: eff.playoffTeams, consolation: eff.consolation };
    s.draftOrderAtStart = [...s.draft.order];
    s.phase = "drafting";
    s.draft.status = "live";
    s.draft.startedAt = Date.now();
    s.draft.deadline = Date.now() + this.st().pickSeconds * 1000;
    this.tx("commish", null, "The draft has started");
    this.notify("The draft is live", `Enter the draft room. ${ROUNDS} rounds, snake order, the clock is running.`, "draft", null, true, { key: `draft:start:${s.draft.startedAt}` });
    const first = this.teamOnClock();
    if (first) this.notify("You're on the clock", "You have the first overall pick.", "draft", [first], true, { key: `draft:clock:1` });
  }

  private makePick(teamId: string, athleteId: string, auto: boolean): void {
    const s = this.require();
    const a = this.athlete(athleteId);
    if (this.ownerOf(athleteId)) throw new ActionError(`${a.name} is already drafted.`);
    const team = this.team(teamId);
    this.setRoster(team, [...this.rosterOf(team), athleteId], `Can't draft ${a.name}`);
    const count = s.draft.order.length;
    const n = s.draft.picks.length;
    const round = Math.floor(n / count) + 1;
    const pickInRound = (n % count) + 1;
    s.draft.picks.push({ overall: n + 1, round, pickInRound, teamId, athleteId, auto, at: Date.now() });
    for (const t of s.teams) t.queue = t.queue.filter((id) => id !== athleteId);
    this.tx("draft", teamId, `${team.teamName} drafted ${a.name}${auto ? " (auto)" : ""} · Rd ${round}, Pick ${pickInRound}`, [athleteId]);
    if (auto) this.notify("Auto-picked for you", `Time ran out, so ${a.name} was drafted for you (Rd ${round}, Pick ${pickInRound}).`, "draft", [teamId], true, { key: `draft:auto:${n + 1}`, link: { type: "draft" } });
    if (s.draft.picks.length >= count * ROUNDS) {
      this.finishDraft();
      return;
    }
    s.draft.deadline = Date.now() + this.st().pickSeconds * 1000;
    const next = this.teamOnClock();
    if (next) this.notify("You're on the clock", `Pick ${s.draft.picks.length + 1} is yours. ${this.st().pickSeconds}s before auto-pick.`, "draft", [next], true, { key: `draft:clock:${s.draft.picks.length + 1}` });
  }

  private totalWeeks(): number {
    const s = this.require();
    return this.st().regularWeeks + this.playoffRounds();
  }

  private playoffTeamCount(): number {
    const s = this.require();
    const options = [8, 6, 4, 2].filter((n) => n <= this.st().playoffTeams && n <= s.teams.length);
    return options[0] ?? 0;
  }

  private playoffRounds(): number {
    const n = this.playoffTeamCount();
    return n < 2 ? 0 : Math.ceil(Math.log2(n));
  }

  private finishDraft(): void {
    const s = this.require();
    s.draft.status = "done";
    s.draft.deadline = null;
    s.phase = "season";
    s.week = 1;
    s.schedule = this.buildSchedule(s.teams.map((t) => t.id), this.st().regularWeeks);
    const n = this.playoffTeamCount();
    const rounds = this.playoffRounds();
    const size = n < 2 ? 0 : 2 ** rounds;
    s.bracket = n < 2 ? null : {
      size, teams: n, seeded: false, seeds: [], championId: null,
      rounds: Array.from({ length: rounds }, (_, r) => ({
        week: this.st().regularWeeks + r + 1,
        name: roundName(rounds - 1 - r),
        games: Array.from({ length: size / 2 ** (r + 1) }, (_, g) => ({ id: `r${r}g${g}`, top: null, bottom: null, topSeed: null, bottomSeed: null, winnerId: null })),
      })),
    };
    const reverse = [...s.draft.order].reverse();
    for (const t of s.teams) {
      t.waiverPriority = reverse.indexOf(t.id) + 1;
      t.faab = this.st().faabBudget;
      t.queue = [];
      t.addsThisWeek = 0;
    }
    // Yahoo-style: every undrafted player starts on waivers until the first weekly run, then clears to free agency.
    const clearAt = this.waiverClearAt();
    if (clearAt !== null) {
      const owned = new Set(s.teams.flatMap((t) => this.rosterOf(t)));
      for (const a of s.athletes) if (!owned.has(a.id)) s.waivers[a.id] = clearAt;
    }
    this.tx("commish", null, `Draft complete. ${this.st().regularWeeks}-week season${n >= 2 ? ` + ${rounds}-round playoff (${n} teams)` : ""} scheduled.`);
    this.notify("Draft complete", "Rosters are set. Your full season schedule and Week 1 matchup are live.", "draft", null, true, { key: "draft:done", link: { type: "matchup", week: 1 } });
  }

  private buildSchedule(teamIds: string[], weeks: number): Matchup[] {
    const ids: (string | null)[] = [...teamIds];
    if (ids.length % 2 === 1) ids.push(null);
    const n = ids.length;
    const rounds: [string | null, string | null][][] = [];
    const rot = [...ids];
    for (let r = 0; r < n - 1; r++) {
      const pairs: [string | null, string | null][] = [];
      for (let i = 0; i < n / 2; i++) pairs.push(r % 2 === 0 ? [rot[i] ?? null, rot[n - 1 - i] ?? null] : [rot[n - 1 - i] ?? null, rot[i] ?? null]);
      rounds.push(pairs);
      const last = rot.pop() ?? null;
      rot.splice(1, 0, last);
    }
    const out: Matchup[] = [];
    for (let w = 1; w <= weeks; w++) {
      for (const [h, a] of rounds[(w - 1) % rounds.length] ?? []) {
        const home = h ?? a;
        if (!home) continue;
        out.push({ id: `${w}-${home}`, week: w, homeId: home, awayId: h ? a : null, final: false, kind: "regular", round: null });
      }
    }
    return out;
  }

  // MARK: - Playoffs

  private seedBracket(): void {
    const s = this.require();
    const b = s.bracket;
    if (!b || b.seeded) return;
    const order = this.standingsOrder(this.records());
    b.seeds = order.slice(0, b.teams);
    b.seeded = true;
    const pos = seedOrder(b.size);
    const first = b.rounds[0];
    if (!first) return;
    first.games.forEach((g, i) => {
      const ts = pos[i * 2] ?? 0;
      const bs = pos[i * 2 + 1] ?? 0;
      g.topSeed = ts <= b.teams ? ts : null;
      g.bottomSeed = bs <= b.teams ? bs : null;
      g.top = g.topSeed ? b.seeds[g.topSeed - 1] ?? null : null;
      g.bottom = g.bottomSeed ? b.seeds[g.bottomSeed - 1] ?? null : null;
      if (g.top && !g.bottom) g.winnerId = g.top;
      if (!g.top && g.bottom) g.winnerId = g.bottom;
    });
    this.createRoundMatchups(0);
    if (first.games.every((g) => g.winnerId)) this.fillNextRound(0);
    for (const [i, id] of b.seeds.entries()) {
      const bye = first.games.some((g) => g.winnerId === id && (!g.top || !g.bottom));
      this.notify("Clinched a playoff spot", `You're the #${i + 1} seed${bye ? " with a first-round bye" : ""}.`, "playoffs", [id]);
    }
    const out = order.slice(b.teams);
    if (out.length > 0) this.notify("Season over", "You missed the playoffs this year.", "playoffs", out);
    this.tx("commish", null, `Playoff field set: ${b.seeds.map((id, i) => `#${i + 1} ${this.team(id).teamName}`).join(", ")}`);
    if (this.st().consolation && out.length >= 2) {
      for (const round of b.rounds) {
        for (let i = 0; i + 1 < out.length; i += 2) {
          const home = out[i] as string;
          s.schedule.push({ id: `${round.week}-${home}`, week: round.week, homeId: home, awayId: out[i + 1] ?? null, final: false, kind: "consolation", round: "Consolation" });
        }
      }
    }
  }

  private createRoundMatchups(r: number): void {
    const s = this.require();
    const round = s.bracket?.rounds[r];
    if (!round) return;
    for (const g of round.games) {
      if (!g.top || !g.bottom || g.winnerId) continue;
      const id = `${round.week}-${g.top}`;
      if (s.schedule.some((m) => m.id === id)) continue;
      s.schedule.push({ id, week: round.week, homeId: g.top, awayId: g.bottom, final: false, kind: "playoff", round: round.name });
    }
  }

  private fillNextRound(r: number): void {
    const b = this.require().bracket;
    const cur = b?.rounds[r];
    if (!b || !cur) return;
    const next = b.rounds[r + 1];
    if (!next) {
      const champ = cur.games[0]?.winnerId ?? null;
      b.championId = champ;
      return;
    }
    next.games.forEach((g, i) => {
      const a = cur.games[i * 2];
      const c = cur.games[i * 2 + 1];
      g.top = a?.winnerId ?? null;
      g.bottom = c?.winnerId ?? null;
      g.topSeed = g.top ? b.seeds.indexOf(g.top) + 1 : null;
      g.bottomSeed = g.bottom ? b.seeds.indexOf(g.bottom) + 1 : null;
      if (g.top && g.bottom && (g.bottomSeed ?? 99) < (g.topSeed ?? 99)) {
        [g.top, g.bottom] = [g.bottom, g.top];
        [g.topSeed, g.bottomSeed] = [g.bottomSeed, g.topSeed];
      }
    });
    this.createRoundMatchups(r + 1);
  }

  private advanceBracket(week: number): void {
    const b = this.require().bracket;
    if (!b) return;
    const r = b.rounds.findIndex((x) => x.week === week);
    const round = b.rounds[r];
    if (!round) return;
    for (const g of round.games) {
      if (g.winnerId || !g.top || !g.bottom) continue;
      const ts = this.teamWeekScore(g.top, week);
      const bs = this.teamWeekScore(g.bottom, week);
      g.winnerId = ts > bs ? g.top : bs > ts ? g.bottom : (g.topSeed ?? 99) <= (g.bottomSeed ?? 99) ? g.top : g.bottom;
      const loser = g.winnerId === g.top ? g.bottom : g.top;
      if (r < b.rounds.length - 1) {
        this.notify(`${round.name}: you advance`, `You beat ${this.team(loser).teamName} ${Math.max(ts, bs)}–${Math.min(ts, bs)}.`, "playoffs", [g.winnerId]);
        this.notify("Eliminated", `${this.team(g.winnerId).teamName} knocked you out of the playoffs.`, "playoffs", [loser]);
      }
    }
    this.fillNextRound(r);
  }

  // MARK: - Waivers

  private nextProcessAfter(t: number): number {
    const s = this.require();
    const off = this.st().tzOffsetMin * 60_000;
    const local = new Date(t + off);
    const cand = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), this.st().waiverHour, 0, 0);
    const candUtc = cand - off;
    return candUtc >= t ? candUtc : candUtc + DAY;
  }

  /** When a player dropped now clears waivers: the next weekly run (Yahoo-style), or N days + processing hour (legacy). */
  private waiverClearAt(now = Date.now()): number | null {
    const st = this.st();
    if (st.waiverSchedule !== "daily") return nextWeeklyRun(now, st.waiverDay, st.waiverHour);
    if (st.waiverDays <= 0) return null;
    return this.nextProcessAfter(now + st.waiverDays * DAY);
  }

  /** The next scheduled waiver run (shown to managers as the claim deadline). */
  private nextWaiverRun(now = Date.now()): number {
    const st = this.st();
    if (st.waiverSchedule !== "daily") return nextWeeklyRun(now, st.waiverDay, st.waiverHour);
    const pending = Object.values(this.require().waivers).filter((t) => t > now);
    return pending.length > 0 ? Math.min(...pending) : this.nextProcessAfter(now);
  }

  private putOnWaivers(athleteId: string): void {
    const s = this.require();
    const at = this.waiverClearAt();
    if (at === null) {
      delete s.waivers[athleteId];
      return;
    }
    s.waivers[athleteId] = at;
  }

  /** The Main League changed the waiver schedule: every player still on waivers moves to the new run time. */
  private resyncWaiverSchedule(): boolean {
    const s = this.state;
    if (!s) return false;
    const st = this.st();
    const sig = `${st.waiverSchedule}|${st.waiverDay}|${st.waiverHour}|${st.waiverDays}`;
    if (s.waiverSig === sig) return false;
    const first = s.waiverSig === undefined;
    s.waiverSig = sig;
    if (first || s.phase !== "season" || st.waiverSchedule !== "weekly") return !first;
    const at = nextWeeklyRun(Date.now(), st.waiverDay, st.waiverHour);
    for (const id of Object.keys(s.waivers)) s.waivers[id] = at;
    this.tx("commish", null, `Waivers now run ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][st.waiverDay]} at ${st.waiverHour % 12 === 0 ? 12 : st.waiverHour % 12}:00 ${st.waiverHour < 12 ? "AM" : "PM"} ET`);
    return true;
  }

  private addLimitReached(team: Team): boolean {
    const max = this.st().maxAddsPerWeek;
    return max > 0 && team.addsThisWeek >= max;
  }

  private processWaivers(cutoff: number): void {
    const s = this.require();
    const due = new Set(Object.entries(s.waivers).filter(([, t]) => t <= cutoff).map(([id]) => id));
    if (due.size === 0) return;
    const results: Record<string, string[]> = {};
    const note = (teamId: string, line: string): void => { (results[teamId] ??= []).push(line); };
    const locked = this.lockedIds();
    for (;;) {
      const pending = s.claims.filter((c) => c.status === "pending" && due.has(c.addId));
      if (pending.length === 0) break;
      const prio = (c: Claim): number => this.team(c.teamId).waiverPriority;
      // Each team's own claim order decides which of its claims is tried first (Yahoo-style).
      const rank = (c: Claim): number => c.rank ?? 1_000_000 + c.createdAt / 1e13;
      const faab = this.st().waiverType === "faab";
      let claim: Claim;
      if (faab) {
        pending.sort((a, b) => b.bid - a.bid || prio(a) - prio(b) || rank(a) - rank(b) || a.createdAt - b.createdAt);
        claim = pending[0] as Claim;
      } else {
        // Rolling: the highest-priority team with a live claim goes next, using its top-ranked claim.
        pending.sort((a, b) => prio(a) - prio(b) || rank(a) - rank(b) || a.createdAt - b.createdAt);
        claim = pending[0] as Claim;
      }
      const team = this.team(claim.teamId);
      const fail = (reason: string): void => {
        claim.status = "lost";
        claim.reason = reason;
        claim.resolvedAt = Date.now();
        note(team.id, `✗ ${this.nameOf(claim.addId)} — ${reason}`);
      };
      if (this.ownerOf(claim.addId)) { fail("already claimed"); continue; }
      if (locked.has(claim.addId) || (claim.dropId && locked.has(claim.dropId))) { fail("a player in this claim is locked for this week's meet"); continue; }
      if (claim.dropId && !this.rosterOf(team).includes(claim.dropId)) { fail("drop athlete no longer on roster"); continue; }
      if (this.st().waiverType === "faab" && claim.bid > team.faab) { fail("not enough budget"); continue; }
      if (this.addLimitReached(team)) { fail("weekly add limit reached"); continue; }
      const irBad = this.irProblem(team);
      if (irBad && irBad.id !== claim.dropId) { fail(`${irBad.name} must be moved out of IR first`); continue; }
      const next = this.rosterOf(team).filter((id) => id !== claim.dropId).concat(claim.addId);
      if (!this.canHold(team, next)) { fail("no roster spot fits"); continue; }
      this.setRoster(team, next, "Claim");
      if (claim.dropId) {
        this.putOnWaivers(claim.dropId);
        this.failTradesInvolving([claim.dropId]);
      }
      claim.status = "won";
      claim.resolvedAt = Date.now();
      team.addsThisWeek++;
      if (this.st().waiverType === "faab") team.faab -= claim.bid;
      else {
        const old = team.waiverPriority;
        for (const t of s.teams) if (t.waiverPriority > old) t.waiverPriority--;
        team.waiverPriority = s.teams.length;
      }
      claim.reason = "";
      delete s.waivers[claim.addId];
      due.delete(claim.addId);
      for (const c of s.claims) {
        if (c.status === "pending" && c.addId === claim.addId) {
          c.status = "lost";
          c.reason = `claimed by ${team.teamName}`;
          c.resolvedAt = Date.now();
          note(c.teamId, `✗ ${this.nameOf(c.addId)} — claimed by ${team.teamName}`);
        }
      }
      const bidText = this.st().waiverType === "faab" ? ` ($${claim.bid})` : "";
      this.tx("waiver", team.id, `${team.teamName} claimed ${this.nameOf(claim.addId)}${bidText}${claim.dropId ? `, dropped ${this.nameOf(claim.dropId)}` : ""}`, [claim.addId, ...(claim.dropId ? [claim.dropId] : [])]);
      note(team.id, `✓ ${this.nameOf(claim.addId)}${bidText}`);
    }
    for (const id of due) delete s.waivers[id];
    for (const [teamId, lines] of Object.entries(results)) {
      const won = lines.filter((l) => l.startsWith("✓")).length;
      this.notify(won > 0 ? (won === 1 ? "Waiver claim won" : `${won} waiver claims won`) : "Waiver claim lost", lines.join("\n"), "waiver", [teamId]);
    }
  }

  // MARK: - Trades

  private tradeDeadlinePassed(): boolean {
    const s = this.require();
    return this.st().tradeDeadlineWeek > 0 && s.week > this.st().tradeDeadlineWeek;
  }

  private validateTrade(t: Trade): void {
    const from = this.team(t.fromId);
    const to = this.team(t.toId);
    const fr = this.rosterOf(from);
    const tr = this.rosterOf(to);
    if (!t.give.every((id) => fr.includes(id)) || !t.get.every((id) => tr.includes(id))) throw new ActionError("Rosters changed — this trade can no longer go through.");
    this.assertNotLocked([...t.give, ...t.get]);
    if (!this.canHold(from, fr.filter((id) => !t.give.includes(id)).concat(t.get))) throw new ActionError(`${from.teamName} wouldn't have a legal roster after this trade.`);
    if (!this.canHold(to, tr.filter((id) => !t.get.includes(id)).concat(t.give))) throw new ActionError(`${to.teamName} wouldn't have a legal roster after this trade.`);
  }

  private completeTrade(t: Trade): void {
    try {
      this.validateTrade(t);
    } catch {
      t.status = "failed";
      t.resolvedAt = Date.now();
      this.notify("Trade failed", "Rosters changed before the trade could process.", "trade", [t.fromId, t.toId], true, { key: `trade:${t.id}:failed` });
      return;
    }
    const from = this.team(t.fromId);
    const to = this.team(t.toId);
    // All-or-nothing: both new rosters are solved before either team changes.
    const fromNext = this.solve(this.rosterOf(from).filter((id) => !t.give.includes(id)).concat(t.get), from.lineup);
    const toNext = this.solve(this.rosterOf(to).filter((id) => !t.get.includes(id)).concat(t.give), to.lineup);
    if (!fromNext || !toNext) {
      t.status = "failed";
      t.resolvedAt = Date.now();
      this.notify("Trade failed", "One roster couldn't fit the incoming athletes.", "trade", [t.fromId, t.toId], true, { key: `trade:${t.id}:failed` });
      return;
    }
    from.lineup = fromNext;
    to.lineup = toNext;
    t.status = "accepted";
    t.resolvedAt = Date.now();
    for (const id of [...t.give, ...t.get]) delete this.require().waivers[id];
    this.failTradesInvolving([...t.give, ...t.get], t.id);
    const text = `${from.teamName} traded ${this.names(t.give)} to ${to.teamName} for ${this.names(t.get)}`;
    this.tx("trade", from.id, text, [...t.give, ...t.get], { otherId: to.id, status: "completed" });
    this.notify("Trade completed", `${this.names(t.get)} ${t.get.length === 1 ? "is" : "are"} now on ${from.teamName}; ${this.names(t.give)} moved to ${to.teamName}.`, "trade", [t.fromId, t.toId], true, { key: `trade:${t.id}:done` });
    this.notify("Trade processed", text, "trade", this.allIds().filter((id) => id !== t.fromId && id !== t.toId), false, { key: `trade:${t.id}:league`, category: "league", link: { type: "transactions" } });
  }

  // MARK: - Results

  private buildResult(action: Record<string, unknown>): Result {
    const s = this.require();
    const str = (k: string): string => String(action[k] ?? "").trim();
    const optInt = (k: string, min: number, max: number): number | null => {
      const v = action[k];
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null;
    };
    const meet = str("meet").slice(0, 60);
    const date = str("date");
    const eventName = str("event").slice(0, 40);
    if (!meet) throw new ActionError("Enter the meet name.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError("Enter the meet date.");
    if (!eventName) throw new ActionError("Pick an event.");
    const info = eventInfo(eventName);
    const athleteIds = [...new Set(Array.isArray(action.athleteIds) ? (action.athleteIds as unknown[]).map(String) : [])];
    if (athleteIds.length === 0) throw new ActionError("Pick at least one athlete.");
    for (const id of athleteIds) this.athlete(id);
    const relay = info.relay || action.relay === true;
    if (!relay && athleteIds.length !== 1) throw new ActionError("Individual events take exactly one athlete.");
    if (relay && athleteIds.length > 6) throw new ActionError("A relay has at most 6 athletes.");
    const statusRaw = str("status").toUpperCase();
    const status: ResultStatus = statusRaw === "DQ" || statusRaw === "DNF" ? statusRaw : "OK";
    const bestRaw = str("best");
    const best: BestOverride = bestRaw === "PB" || bestRaw === "SB" || bestRaw === "none" ? bestRaw : "auto";
    const gender: Gender = str("gender") === "G" || str("gender") === "B" ? (str("gender") as Gender) : this.athlete(athleteIds[0] as string).gender;
    const week = clampInt(action.week, 1, Math.max(1, s.week), s.week);
    const key = resultKey(meet, date, info.name, athleteIds, relay, gender);
    const existingId = str("resultId");
    const existing = (existingId ? this.results.get(existingId) : undefined) ?? [...this.results.values()].find((r) => r.key === key);
    return {
      id: existing?.id ?? uid(),
      key, week, meet, date, event: info.name, gender, athleteIds, relay,
      mark: str("mark").slice(0, 20),
      place: optInt("place", 1, 999),
      heatPlace: optInt("heatPlace", 1, 999),
      seeded: optInt("seeded", 1, 9999),
      status, best,
      enteredAt: existing?.enteredAt ?? Date.now(),
      source: action.source === "import" ? "import" : "form",
    };
  }

  private async afterScoringChange(week: number, summary: string, announce: Result[] = []): Promise<void> {
    const s = this.require();
    this.recompute();
    if (s.phase === "season" && week === s.week) this.refreshLocks();
    this.tx("score", null, summary);
    if (s.phase === "season") this.pushLiveActivities(week, false);
    this.announceResults(announce);
  }

  /** Team that started this athlete (SPR/DIS/FLD/FLEX) in that week's lineup, if any. */
  private starterTeam(athleteId: string, week: number): Team | null {
    for (const t of this.require().teams) {
      const lineup = this.lineupFor(t.id, week);
      if (STARTERS.some((slot) => lineup[slot] === athleteId)) return t;
    }
    return null;
  }

  /**
   * One notification per official result per starter, plus one "Scoring update" when a correction changes the points.
   * `notedPoints` remembers what was announced, so repeated syncs and reconnects never repeat it.
   */
  private announceResults(results: Result[]): void {
    const s = this.require();
    if (s.phase !== "season" && s.phase !== "complete") return;
    const wanted = new Set(results.filter((r) => !r.historyOnly && !r.provisional).map((r) => r.id));
    if (wanted.size === 0) return;
    const totals = new Map<string, number>();
    for (const l of this.lines) {
      if (!wanted.has(l.sourceId)) continue;
      const k = `${l.sourceId}|${l.athleteId}`;
      totals.set(k, (totals.get(k) ?? 0) + l.points);
    }
    for (const r of results) {
      if (!wanted.has(r.id)) continue;
      for (const aid of r.athleteIds) {
        const k = `${r.id}|${aid}`;
        const pts = round2(totals.get(k) ?? 0);
        const prev = s.notedPoints[k];
        if (prev !== undefined && Math.abs(prev - pts) < 0.001) continue;
        s.notedPoints[k] = pts;
        const team = this.starterTeam(aid, r.week);
        if (!team) continue;
        const name = this.nameOf(aid);
        const signed = `${pts >= 0 ? "+" : ""}${pts}`;
        const link: NoteLink = { type: "player", id: aid, week: r.week };
        if (prev === undefined) {
          const how = r.status !== "OK" ? `was ${r.status === "DQ" ? "disqualified" : "a DNF"} in the ${r.event}` : r.place ? `finished ${ordinal(r.place)} in the ${r.event}` : `competed in the ${r.event}`;
          this.notify(`${name}: ${signed} pts`, `${name} ${how}${r.mark ? ` (${r.mark})` : ""} at ${r.meet}, ${signed} fantasy points.`, "player", [team.id], true, { key: `res:${k}`, category: "live", link });
        } else {
          this.notify("Scoring update", `${name}'s ${r.event} score at ${r.meet} was updated from ${prev} to ${pts}.`, "player", [team.id], true, { key: `resfix:${k}:${prev}>${pts}`, category: "live", link });
        }
      }
    }
    const keys = Object.keys(s.notedPoints);
    if (keys.length > 6000) for (const k of keys.slice(0, keys.length - 5000)) delete s.notedPoints[k];
  }

  // MARK: - Audit + Postgres mirror

  private audit(user: User, action: string, detail: string): void {
    const s = this.require();
    const row: Audit = { id: uid(), at: Date.now(), actorId: user.id, actorName: user.name, action, detail: detail.slice(0, 600) };
    s.audit.push(row);
    this.mirror("audit_log", [{ id: `${s.id}:${row.id}`, league_id: s.id, actor_id: row.actorId, actor_name: row.actorName, action, detail: { text: row.detail }, created_at: iso(row.at) }]);
  }

  private mirror(table: string, rows: Record<string, unknown>[]): void {
    if (!this.db.enabled || rows.length === 0) return;
    this.ctx.waitUntil(this.db.upsert(table, rows).catch((e: unknown) => console.warn(`mirror ${table} failed`, String(e))));
  }

  private meetRow(m: Meet): Record<string, unknown> {
    const s = this.require();
    return {
      id: `${s.id}:${m.id}`, league_id: s.id, name: m.name, meet_date: m.date || null, week: m.week, provider: m.provider, status: m.status,
      events_url: m.eventsUrl || null, roster_url: m.rosterUrl || null, results_url: m.resultsUrl || null, is_demo: m.isDemo, live: m.polling,
      last_synced_at: iso(m.lastSyncedAt), last_error: m.sourceError, results_processed: m.stats.processed, athletes_matched: m.stats.matched,
      unmatched: m.stats.unmatched, updated_at: new Date().toISOString(),
    };
  }

  private unmatchedRow(u: Unmatched): Record<string, unknown> {
    const s = this.require();
    return {
      id: `${s.id}:${u.id}`, league_id: s.id, meet_id: `${s.id}:${u.meetId}`, kind: u.kind, source_name: u.sourceName, school: u.school,
      gender: u.gender, bib: u.bib, event_name: u.eventName, result: u.result, candidates: u.candidates, status: u.status,
      resolved_athlete_id: u.resolvedAthleteId, resolved_by: u.resolvedBy, created_at: iso(u.createdAt), resolved_at: iso(u.resolvedAt),
    };
  }

  /** ScoringEvents + performance history in Postgres always equal the engine's current output. */
  private mirrorScoring(): void {
    if (!this.db.enabled) return;
    const s = this.require();
    const holder = new Map<string, { teamId: string; matchupId: string | null }>();
    const holderAt = (aid: string, week: number): { teamId: string; matchupId: string | null } | null => {
      const k = `${aid}|${week}`;
      if (holder.has(k)) return holder.get(k) ?? null;
      let found: { teamId: string; matchupId: string | null } | null = null;
      for (const t of s.teams) {
        const lineup = this.lineupFor(t.id, week);
        if (SLOT_IDS.some((slot) => lineup[slot] === aid)) {
          const m = s.schedule.find((x) => x.week === week && (x.homeId === t.id || x.awayId === t.id));
          found = { teamId: t.id, matchupId: m?.id ?? null };
          break;
        }
      }
      if (found) holder.set(k, found);
      return found;
    };
    const events = this.lines.map((l) => {
      const h = holderAt(l.athleteId, l.week);
      return {
        id: `${s.id}:${l.id}`, league_id: s.id, week: l.week, meet_id: l.meetId ? `${s.id}:${l.meetId}` : null, athlete_id: l.athleteId,
        fantasy_team_id: h?.teamId ?? null, matchup_id: h?.matchupId ?? null, event: l.event, source_result_id: l.sourceId,
        category: categoryOf(l), points: l.points, explanation: [l.label, l.detail].filter(Boolean).join(" · "), provisional: l.provisional, is_demo: false,
      };
    });
    const hist: Record<string, unknown>[] = [];
    for (const [aid, byEvent] of Object.entries(this.history)) {
      for (const h of Object.values(byEvent)) {
        hist.push({ id: `${s.id}:${aid}:${keyOf(h.event)}:${s.season}`, league_id: s.id, athlete_id: aid, event: h.event, season: s.season, lifetime_pb: h.lifetimePb, season_best: h.seasonBest, results: h.results });
      }
    }
    this.ctx.waitUntil(
      Promise.all([this.db.replace("scoring_events", s.id, events), this.db.replace("performance_history", s.id, hist)])
        .catch((e: unknown) => console.warn("mirror scoring failed", String(e))),
    );
  }

  private mirrorStandards(): void {
    if (!this.db.enabled) return;
    const s = this.require();
    const rows = this.scoring.standards.map((st) => ({
      id: `${s.id}:${st.id}`, league_id: s.id, season: st.season, gender: st.gender, event: st.event, standard_type: st.type,
      required_mark: st.mark, points: st.points, active: st.active, updated_at: new Date().toISOString(),
    }));
    this.ctx.waitUntil(this.db.replace("scoring_standards", s.id, rows).catch((e: unknown) => console.warn("mirror standards failed", String(e))));
  }

  // MARK: - Live meets

  private meet(id: string): Meet {
    const m = this.require().meets.find((x) => x.id === id);
    if (!m) throw new ActionError("Meet not found.");
    return m;
  }

  private pool(): PoolAthlete[] {
    return this.require().athletes.map((a) => ({ id: a.id, name: a.name, gender: a.gender, school: a.school ?? "" }));
  }

  /** athleteId → fantasy team (and matchup) that rosters them for the meet's week. */
  private relevance(week: number): Map<string, { teamId: string; matchupId: string | null }> {
    const s = this.require();
    const out = new Map<string, { teamId: string; matchupId: string | null }>();
    for (const t of s.teams) {
      const m = s.schedule.find((x) => x.week === week && (x.homeId === t.id || x.awayId === t.id)) ?? null;
      const lineup = this.lineupFor(t.id, week);
      for (const slot of SLOT_IDS) {
        const aid = lineup[slot];
        if (aid) out.set(aid, { teamId: t.id, matchupId: m?.id ?? null });
      }
    }
    return out;
  }

  private async loadFeed(m: Meet): Promise<RawFeed> {
    if (m.scope === "global") {
      // Global meets are read once by the Directory; every league scores that same stored copy.
      const r = await this.dirGet(`/global-feed?meetId=${encodeURIComponent(m.id)}`);
      if (!r.ok) throw new SourceError("The shared meet data couldn't be loaded.", "unreachable");
      const feed = (await r.json()) as RawFeed;
      if (!feed.results.trim() && m.sourceError) throw new SourceError(m.sourceError, m.sourceErrorKind ?? "unreachable");
      return feed;
    }
    if (m.provider === "MANUAL") {
      const feed = await this.ctx.storage.get<RawFeed>(`feed:${m.id}`);
      if (!feed || !feed.results.trim()) throw new SourceError("Paste the results data for this meet first.", "config");
      return feed;
    }
    const feed = (await fetchMeetFeed(m)).feed;
    return m.testMeet && m.testMode ? applyTestMode(feed, m.testMode) : feed;
  }

  /** Confirmed source athlete id → master player links (global, from the Directory). Refreshed at most once a minute. */
  private links: Map<string, SourceLink> = new Map();
  /** identityKey(alias)|gender → master player ids (commissioner-confirmed, global). */
  private aliases: Map<string, string[]> = new Map();
  private linksAt = 0;

  private async loadLinks(force = false): Promise<void> {
    if (!force && Date.now() - this.linksAt < 60_000) return;
    try {
      const r = await this.dirGet("/source-links");
      if (!r.ok) return;
      const body = (await r.json()) as { links?: SourceLink[]; aliases?: { alias: string; athleteId: string; gender: string }[] };
      this.links = new Map((body.links ?? []).map((l) => [l.sourceId, l]));
      const al = new Map<string, string[]>();
      for (const a of body.aliases ?? []) {
        const k = `${a.alias}|${a.gender}`;
        al.set(k, [...new Set([...(al.get(k) ?? []), a.athleteId])]);
      }
      this.aliases = al;
      this.linksAt = Date.now();
    } catch (e) {
      console.warn("source links load failed", String(e));
    }
  }

  /**
   * Source athlete → Fantasy T&F athlete for every row (Cornwall Central pool). Only high-confidence evidence is applied;
   * ambiguous Cornwall athletes and source-id conflicts go to review; other schools are never associated.
   */
  private analyze(m: Meet, rows: NormalizedMeetResult[]): Analysis {
    const s = this.require();
    const pool = this.pool();
    const rel = this.relevance(m.week);
    const out: Analysis = {
      rowIds: new Map(), matchType: new Map(), weak: new Map(), sourceAthletes: 0, matchedIds: new Set(), relevantIds: new Set(),
      evidence: new Map(), rowSrc: new Map(), poolAthletes: 0,
    };
    const srcOf = (r: NormalizedMeetResult): SourceAthlete => ({
      first: r.firstName, last: r.lastName, gender: r.gender, school: r.school, bib: r.bib,
      sourceId: r.sourceAthleteId ?? null, teamId: r.teamId ?? null, region: r.region ?? null, grade: r.grade || null,
    });
    const memberSrc = (r: NormalizedMeetResult, mem: { first: string; last: string; bib: string | null }): SourceAthlete => ({
      first: mem.first, last: mem.last, gender: r.gender, school: r.school, bib: mem.bib && !mem.bib.startsWith("anet:") ? mem.bib.replace(/^bib:/, "") : null,
      sourceId: mem.bib?.startsWith("anet:") ? mem.bib : null, teamId: r.teamId ?? null, region: r.region ?? null, grade: null,
    });
    const identity = (a: SourceAthlete): string => (a.sourceId ? `s${a.sourceId}` : a.bib ? `b${a.bib}` : `n${fullNorm(a)}|${normSchool(a.school)}`);

    const distinct = new Map<string, { src: SourceAthlete; rows: NormalizedMeetResult[] }>();
    const addSrc = (src: SourceAthlete, row: NormalizedMeetResult): string => {
      const k = identity(src);
      const cur = distinct.get(k) ?? { src, rows: [] };
      cur.rows.push(row);
      distinct.set(k, cur);
      return k;
    };
    for (const r of rows) {
      if (!r.relay) out.rowSrc.set(r.id, addSrc(srcOf(r), r));
      else for (const mem of r.relayMembers) addSrc(memberSrc(r, mem), r);
    }
    out.sourceAthletes = distinct.size;
    // Same name twice among this meet's Cornwall athletes (different source ids) → never auto-matched.
    const nameCount = new Map<string, number>();
    for (const { src } of distinct.values()) {
      if (!isPoolSchool(src.school, src.teamId, src.region)) continue;
      out.poolAthletes++;
      const nk = `${src.gender}|${fullNorm(src)}`;
      nameCount.set(nk, (nameCount.get(nk) ?? 0) + 1);
    }
    const resolved = new Map<string, string | null>();
    for (const [k, { src, rows: srcRows }] of distinct) {
      const hit = matchPoolAthlete(src, m.id, pool, s.mappings, this.links, nameCount.get(`${src.gender}|${fullNorm(src)}`) ?? 1, this.aliases);
      out.evidence.set(k, { src, match: hit });
      resolved.set(k, hit.athleteId);
      if (hit.athleteId) {
        out.matchedIds.add(hit.athleteId);
        out.matchType.set(hit.athleteId, hit.type);
        continue;
      }
      if ((hit.type === "review" || hit.type === "conflict") && hit.candidates.length > 0) {
        const mapKeys = [nameKey(src), ...(src.bib ? [bibKey(m.id, src.bib)] : [])];
        out.weak.set(`a:${m.id}|${k}`, { kind: "athlete", src, mapKeys, candidates: hit.candidates, rows: srcRows, note: hit.reason });
      }
    }

    for (const r of rows) {
      if (!r.relay) {
        const id = resolved.get(out.rowSrc.get(r.id) ?? "") ?? null;
        out.rowIds.set(r.id, id ? [id] : []);
        continue;
      }
      if (r.relayMembers.length > 0) {
        const ids = r.relayMembers.map((mem) => resolved.get(identity(memberSrc(r, mem))) ?? null).filter((x): x is string => !!x);
        out.rowIds.set(r.id, [...new Set(ids)]);
        continue;
      }
      const rk = `r:${m.id}|${r.gender ?? "X"}|${keyOf(r.event ?? r.eventName)}|${normSchool(r.school)}${r.relayDesig ? `~${norm(r.relayDesig)}` : ""}`;
      const mapped = s.mappings[rk];
      if (mapped) {
        out.rowIds.set(r.id, (mapped.athleteIds ?? []).filter((id) => !!this.maybeAthlete(id)));
        continue;
      }
      out.rowIds.set(r.id, []);
      // Relay legs not published: Cornwall relays go to review (never guessed); other schools' relays are ignored.
      if (!isPoolSchool(r.school, r.teamId, r.region)) continue;
      const candidates = pool.filter((a) => a.gender === r.gender && isPoolSchool(poolSchoolOf(a.school))).map((a) => a.id).slice(0, 60);
      if (candidates.length > 0) {
        out.weak.set(`r:${rk}`, { kind: "relay", src: { first: "", last: r.school, gender: r.gender, school: r.school, bib: null }, mapKeys: [rk], candidates, rows: [r] });
      }
    }
    for (const ids of out.rowIds.values()) for (const id of ids) {
      out.matchedIds.add(id);
      if (rel.has(id)) out.relevantIds.add(id);
    }
    return out;
  }

  /** Main League only: records confident source-id links so later meets match instantly (conflicts are flagged, never merged). */
  private recordLinks(m: Meet, a: Analysis): void {
    if (!this.isMain()) return;
    const obs: Record<string, unknown>[] = [];
    for (const { src, match } of a.evidence.values()) {
      if (!src.sourceId || !match.athleteId || match.type === "source_id") continue;
      obs.push({ sourceId: src.sourceId, athleteId: match.athleteId, name: `${src.first} ${src.last}`.trim(), school: src.school, gender: src.gender ?? "", grade: src.grade ?? "", meetId: m.sourceMeetId ?? m.id });
    }
    for (const { src, match } of a.evidence.values()) {
      if (!src.sourceId || match.type !== "source_id") continue;
      obs.push({ sourceId: src.sourceId, athleteId: match.athleteId, name: `${src.first} ${src.last}`.trim(), school: src.school, gender: src.gender ?? "", grade: src.grade ?? "", meetId: m.sourceMeetId ?? m.id, seen: true });
    }
    if (obs.length === 0) return;
    this.ctx.waitUntil(
      this.env.DO.fetch(new Request("https://internal/source-links", { method: "POST", headers: DIR_HEADERS, body: JSON.stringify({ observations: obs.slice(0, 400) }) }))
        .then(() => { this.linksAt = 0; })
        .catch((e: unknown) => console.warn("record links failed", String(e))),
    );
  }

  /** PB/SB from the source's own pre-meet PR / season record when published (strictly better only; ties earn nothing). */
  private bestFromSource(r: NormalizedMeetResult): BestOverride {
    if (r.relay || !r.event || r.resultStatus !== "OK" || !r.mark) return "auto";
    const pb = (r.srcPb ?? "").trim();
    const sb = (r.srcSb ?? "").trim();
    if (!pb && !sb) return "auto";
    const kind = eventInfo(r.event).kind;
    const v = measureForEvent(r.mark, r.event).m?.value ?? null;
    if (v === null) return "none";
    const read = (t: string): number | null => (t ? measureForEvent(t, r.event as string).m?.value ?? null : null);
    const better = (x: number, y: number): boolean => (kind === "time" ? x < y - 1e-9 : x > y + 1e-9);
    const pv = read(pb);
    const sv = read(sb);
    if (pv !== null && better(v, pv)) return "PB";
    if (sv !== null && better(v, sv)) return "SB";
    if (pv === null && sv === null) return "auto";
    return "none";
  }

  private detailFor(r: NormalizedMeetResult, provisional: boolean, nonAdvancer: boolean): string {
    const parts: string[] = [];
    if (r.resultStatus !== "OK") parts.push(r.resultStatus);
    else if (provisional) parts.push(r.livePlace ? `Live · currently ${ordinal(r.livePlace)}` : "Live");
    else if (nonAdvancer && r.place) parts.push(`${ordinal(r.place)} in prelims`);
    else if (r.place) parts.push(`${ordinal(r.place)}${r.relay ? " relay" : " overall"}`);
    if (r.mark) parts.push(r.mark);
    if (r.heat !== null) parts.push(`${eventInfo(r.event ?? "").kind === "field" ? "Flight" : "Heat"} ${r.heat}${r.heatPlace ? ` (${ordinal(r.heatPlace)})` : ""}`);
    if (r.round === "PRELIM") parts.push("Prelim");
    return parts.join(" · ");
  }

  /** Turns normalized rows into engine Results for the rostered athletes only. */
  private buildLiveResults(m: Meet, out: NormalizeOutput, a: Analysis, meetFinal: boolean): Map<string, Result | null> {
    const rel = this.relevance(m.week);
    const now = Date.now();
    const date = m.date || new Date().toISOString().slice(0, 10);
    const finalsFor = new Set<string>();
    const athleteFinal = new Set<string>();
    const comp = (r: NormalizedMeetResult): string => r.compKey ?? `${r.gender}|${r.event}`;
    // Field size = everyone who competed in the event. When prelims were run, finalists are ranked against the full prelim field.
    const prelimField = new Map<string, number>();
    for (const r of out.rows) if (r.round === "PRELIM" && r.seededCount) prelimField.set(comp(r), Math.max(prelimField.get(comp(r)) ?? 0, r.seededCount));
    for (const r of out.rows) {
      if (r.round !== "FINAL" || !r.event) continue;
      finalsFor.add(comp(r));
      for (const id of a.rowIds.get(r.id) ?? []) athleteFinal.add(`${id}|${comp(r)}`);
    }
    const built = new Map<string, Result | null>();
    for (const r of out.rows) {
      if (!r.event) continue;
      const ids = a.rowIds.get(r.id) ?? [];
      if (ids.length === 0 || r.resultStatus === "DNS") {
        built.set(r.id, null);
        continue;
      }
      // Every matched pool athlete earns personal points, rostered or not; team totals only count lineup starters.
      // A history meet (earlier results) only feeds PB/SB history and projections: never fantasy points.
      if (m.history && r.relay) { built.set(r.id, null); continue; }
      let historyOnly = m.history === true;
      let provisional = r.completeness === "LIVE";
      let place = r.place;
      let pctPlace: number | null = null;
      let nonAdvancer = false;
      if (r.round === "PRELIM" && !r.relay) {
        const aid = ids[0] as string;
        if (athleteFinal.has(`${aid}|${comp(r)}`)) historyOnly = true;
        else if (finalsFor.has(comp(r))) { nonAdvancer = true; pctPlace = place; place = null; }
        else if (!meetFinal) provisional = true;
      }
      let heatPlace = r.heatPlace;
      if (provisional) { place = null; pctPlace = null; if (!r.heatComplete) heatPlace = null; }
      const status: ResultStatus = r.resultStatus === "DQ" ? "DQ" : r.resultStatus === "DNF" ? "DNF" : "OK";
      built.set(r.id, {
        id: `live${hash(r.id)}`,
        key: `live|${r.id}`,
        sourceKey: r.id,
        week: m.week, meet: m.name, date, event: r.event, gender: r.gender ?? this.athlete(ids[0] as string).gender,
        athleteIds: historyOnly ? ids.slice(0, 1) : r.relay ? ids : ids.slice(0, 1),
        relay: r.relay, mark: r.mark, place, heatPlace, seeded: r.round === "FINAL" && prelimField.has(comp(r)) ? Math.max(r.seededCount ?? 0, prelimField.get(comp(r)) ?? 0) : r.seededCount, status, best: this.bestFromSource(r),
        enteredAt: now, source: "live", meetId: m.id, provisional, historyOnly, pctPlace,
        seq: r.round === "PRELIM" ? 0 : 1, eventId: r.sourceEventId, seedMark: r.seedMark || null, heat: r.heat, round: r.round,
        fieldStrength: r.relay ? null : m.fieldProfile?.[`${r.gender}|${eventInfo(r.event).name}`]?.strength ?? null,
        section: /\bun-?seeded\b/i.test(r.eventName) ? "unseeded" : /\bseeded\b/i.test(r.eventName) ? "seeded" : null,
        detail: this.detailFor(r, provisional, nonAdvancer),
      });
    }
    return built;
  }

  /** Per-meet serialization: two simultaneous imports of the same meet run one after the other, never interleaved. */
  private syncChains: Map<string, Promise<unknown>> = new Map();
  private syncStats = { runs: 0, serialized: 0 };

  private syncMeet(meetId: string, opts: { final?: boolean } = {}): Promise<{ changed: number; error: string | null }> {
    const prev = this.syncChains.get(meetId);
    if (prev) this.syncStats.serialized++;
    this.syncStats.runs++;
    const run = (prev ?? Promise.resolve()).catch(() => undefined).then(() => this.syncMeetNow(meetId, opts));
    const tail = run.catch(() => undefined);
    this.syncChains.set(meetId, tail);
    void tail.then(() => { if (this.syncChains.get(meetId) === tail) this.syncChains.delete(meetId); });
    return run;
  }

  /** syncMeetResults(meetId): retrieve → normalize → match → filter to rostered athletes → score → update matchups. */
  private async syncMeetNow(meetId: string, opts: { final?: boolean } = {}): Promise<{ changed: number; error: string | null }> {
    const s = this.require();
    const m = this.meet(meetId);
    const now = Date.now();
    // Global meets: status, polling and source bookkeeping belong to the Directory; this league only scores the data.
    const isGlobal = m.scope === "global";
    if (!isGlobal) m.lastAttemptAt = now;
    const meetFinal = opts.final === true || m.status === "FINAL";
    let out: NormalizeOutput;
    let feed: RawFeed;
    try {
      feed = await this.loadFeed(m);
      out = normalizeFeed(m.id, feed, meetFinal, now, s.eventMap);
      if (out.format !== "empty" && out.rows.length === 0) throw new SourceError("The results feed was readable but contained no results rows.", "format");
    } catch (e) {
      const msg = e instanceof SourceError ? e.message : "Live source unavailable.";
      const kind = e instanceof SourceError ? e.kind : "unreachable";
      if (isGlobal) return { changed: 0, error: msg };
      if (m.sourceError !== msg && m.polling) this.notify("Live source unavailable", `${m.name}: ${msg} Existing scores are kept; retrying.`, "commish", [s.commissionerId], m.failures === 0);
      m.sourceError = msg;
      m.sourceErrorKind = kind;
      m.sourceErrorAt = now;
      m.failures += 1;
      if (m.polling) m.nextSyncAt = now + Math.min(120_000, POLL_MS * 2 ** Math.min(3, m.failures));
      this.mirror("meets", [this.meetRow(m)]);
      return { changed: 0, error: msg };
    }
    if (!isGlobal) {
      m.sourceError = null;
      m.sourceErrorKind = null;
      m.failures = 0;
      m.syncCount += 1;
      m.lastSyncedAt = now;
    }

    await this.loadLinks();
    m.fieldProfile = this.profileOf(m, out.rows);
    const analysis = this.analyze(m, out.rows);
    const built = this.buildLiveResults(m, out, analysis, meetFinal);
    this.recordLinks(m, analysis);

    // Schedule (start times), entries, first-result times and finished events: these drive per-player locks,
    // projections and the commissioner's "table missing" flag.
    if (feed.events.trim() && !m.isDemo && !m.history) {
      const sched = parseSchedule(feed.events, this.st().tzOffsetMin);
      if (sched.length > 0) m.schedule = sched;
    }
    const entries: Record<string, string[]> = {};
    const entryEvents: Record<string, string[]> = {};
    m.eventsStarted ??= {};
    const byEvent = new Map<string, NormalizedMeetResult[]>();
    for (const r of out.rows) {
      const posted = r.mark !== "" || r.place !== null || r.heatPlace !== null || r.livePlace !== null || r.resultStatus !== "OK";
      if (posted && m.eventsStarted[r.sourceEventId] === undefined) m.eventsStarted[r.sourceEventId] = now;
      for (const aid of analysis.rowIds.get(r.id) ?? []) {
        if (!(entries[aid] ?? []).includes(r.sourceEventId)) (entries[aid] ??= []).push(r.sourceEventId);
        if (r.event && !(entryEvents[aid] ?? []).includes(r.event)) (entryEvents[aid] ??= []).push(r.event);
      }
      if (r.event && r.gender) byEvent.set(`${r.gender}|${r.event}`, [...(byEvent.get(`${r.gender}|${r.event}`) ?? []), r]);
    }
    // Entries only grow during a meet (a scratched athlete stays locked once their event started).
    for (const [aid, ids] of Object.entries(m.entries ?? {})) for (const id of ids) if (!(entries[aid] ?? []).includes(id)) (entries[aid] ??= []).push(id);
    // History meets never lock lineups or count as this week's entries.
    m.entries = m.history ? {} : entries;
    m.entryEvents = m.history ? {} : entryEvents;
    if (m.history) m.eventsStarted = {};
    m.completedEvents = [...byEvent.entries()].filter(([, rs]) => rs.every((r) => r.completeness !== "LIVE")).map(([k]) => k);
    const missing = new Set<string>();
    for (const [k] of byEvent) {
      const [g, ev] = k.split("|") as [Gender, string];
      const info = eventInfo(ev);
      if (info.relay || info.kind === "points") continue;
      if (!hasTable(this.scoringInput([]), ev, g, m.week)) missing.add(`${g === "G" ? "Girls" : "Boys"} ${ev}`);
    }
    m.tablesMissing = [...missing].sort();

    // Review queue: uncertain athletes, unrecognized events.
    const openKeys = new Set<string>();
    const upsertUnmatched = (key: string, fill: Omit<Unmatched, "id" | "key" | "status" | "createdAt" | "resolvedAt" | "resolvedBy" | "resolvedAthleteId">): void => {
      openKeys.add(key);
      const existing = s.unmatched.find((u) => u.key === key);
      if (existing) {
        if (existing.status !== "open") return;
        Object.assign(existing, fill);
        return;
      }
      s.unmatched.push({ id: uid(), key, status: "open", createdAt: now, resolvedAt: null, resolvedBy: null, resolvedAthleteId: null, ...fill });
    };
    const rel = this.relevance(m.week);
    for (const [key, w] of analysis.weak) {
      const r0 = w.rows[0] as NormalizedMeetResult;
      upsertUnmatched(key, {
        meetId: m.id, kind: w.kind, mapKeys: w.mapKeys,
        sourceName: w.kind === "relay" ? `${r0.school} relay` : `${w.src.first} ${w.src.last}`.trim(),
        school: w.src.school, gender: w.src.gender ?? "", bib: w.src.bib ?? "",
        eventName: w.rows.map((r) => r.event ?? r.eventName).filter((v, i, arr) => arr.indexOf(v) === i).join(", "),
        result: w.rows.map((r) => [r.resultStatus !== "OK" ? r.resultStatus : r.place ? ordinal(r.place) : r.livePlace ? `~${ordinal(r.livePlace)}` : "", r.mark].filter(Boolean).join(" ")).join(" · "),
        candidates: w.candidates, relevant: w.candidates.some((c) => rel.has(c)),
        sourceId: w.src.sourceId ?? null,
        ...(w.note ? { result: `${w.note} · ${w.rows.map((r) => [r.resultStatus !== "OK" ? r.resultStatus : r.place ? ordinal(r.place) : "", r.mark].filter(Boolean).join(" ")).join(" · ")}`.slice(0, 400) } : {}),
      });
    }
    for (const u of out.unknownEvents) {
      upsertUnmatched(`e:${u.eventName}`, {
        meetId: m.id, kind: "event", mapKeys: [], sourceName: u.eventName, school: "", gender: "", bib: "",
        eventName: u.eventName, result: `${u.rows} result${u.rows === 1 ? "" : "s"} not scored`, candidates: [], relevant: false,
      });
    }
    // Unreadable or implausible official marks: placement/participation still score, but no time/mark, PB/SB or standard
    // points are awarded until the commissioner corrects the mark (the engine refuses to guess).
    for (const r of out.rows) {
      const res = built.get(r.id);
      if (!res || !r.event || r.relay || res.status !== "OK" || res.historyOnly || r.completeness === "LIVE") continue;
      if (this.results.get(res.id)?.locked) continue;
      if (eventInfo(r.event).kind === "points") continue;
      const { issue } = measureForEvent(r.mark, r.event);
      if (!issue) continue;
      upsertUnmatched(`m:${r.id}`, {
        meetId: m.id, kind: "mark", mapKeys: [res.id], sourceName: this.names(res.athleteIds), school: r.school, gender: r.gender ?? "", bib: r.bib ?? "",
        eventName: r.event, result: `${issue}. Participation/placement kept; mark points withheld until corrected.`, candidates: res.athleteIds,
        relevant: res.athleteIds.some((id) => rel.has(id)),
      });
    }
    // A mark that now reads cleanly (source fixed it) closes its review item automatically.
    for (const u of s.unmatched) {
      if (u.kind !== "mark" || u.meetId !== m.id || u.status !== "open" || openKeys.has(u.key)) continue;
      u.status = "resolved";
      u.resolvedAt = now;
      u.resolvedBy = "source";
    }

    // Apply results (duplicate-safe: one Result per source identity; changes update in place).
    let changed = 0;
    const beforeTotals = new Map<string, number>();
    for (const l of this.lines) if (l.meetId === m.id) beforeTotals.set(l.sourceId, (beforeTotals.get(l.sourceId) ?? 0) + l.points);
    const sig = (r: Result): string => JSON.stringify([r.athleteIds, r.mark, r.place, r.heatPlace, r.seeded, r.status, r.provisional, r.historyOnly, r.pctPlace, r.week, r.meet, r.date, r.event, r.detail, r.best, r.seq, r.heat ?? null]);
    const integ = (s.integrity ??= { unchanged: 0, corrections: 0, removed: 0, imports: 0 });
    integ.imports++;
    const touched: Result[] = [];
    {
      for (const [rowId, next] of built) {
        const id = `live${hash(rowId)}`;
        const cur = this.results.get(id);
        if (cur?.locked) continue;
        if (!next) {
          if (cur) { this.results.delete(id); await this.ctx.storage.delete(`res:${id}`); changed++; integ.removed++; }
          continue;
        }
        if (cur) {
          next.enteredAt = cur.enteredAt;
          next.prev = cur.prev;
          // Same source result delivered again: applied once, never added twice.
          if (sig(cur) === sig(next)) { integ.unchanged++; continue; }
          integ.corrections++;
          // Source corrected an already-posted result: same result id, so its scoring events are replaced in place.
          // The previous official version is kept on the result for the audit history.
          const fmt = (x: Result): string => `${x.status} ${x.mark || "—"} overall ${x.place ?? "–"} heat ${x.heatPlace ?? "–"}`;
          if (!cur.historyOnly && fmt(cur) !== fmt(next)) {
            next.prev = [...(cur.prev ?? []), { at: now, mark: cur.mark, place: cur.place, heatPlace: cur.heatPlace, status: cur.status, provisional: cur.provisional === true }].slice(-10);
            this.audit({ id: "source", name: "Live source" }, "result.source-correction", `${this.names(next.athleteIds)} · ${next.event} @ ${m.name}: ${fmt(cur)} → ${fmt(next)}`);
          }
        }
        this.results.set(id, next);
        await this.ctx.storage.put(`res:${id}`, next);
        touched.push(next);
        changed++;
      }
    }

    m.stats = {
      processed: out.rows.length,
      events: new Set(out.rows.filter((r) => r.event).map((r) => `${r.gender}|${r.event}|${r.round}`)).size,
      eventsFlagged: out.unknownEvents.length,
      sourceAthletes: analysis.sourceAthletes,
      matched: analysis.matchedIds.size,
      relevant: analysis.relevantIds.size,
      unmatched: s.unmatched.filter((u) => u.meetId === m.id && u.status === "open").length,
      scored: m.isDemo ? changed : [...this.results.values()].filter((r) => r.meetId === m.id && !r.historyOnly).length,
      lastChangeAt: changed > 0 ? now : m.stats.lastChangeAt,
    };

    if (!m.isDemo && changed > 0) {
      this.recompute();
      if (s.phase === "season" && m.week === s.week) this.refreshLocks(now);
      if (s.phase === "season") this.pushLiveActivities(m.week, false);
      const afterTotals = new Map<string, number>();
      for (const l of this.lines) if (l.meetId === m.id) afterTotals.set(l.sourceId, (afterTotals.get(l.sourceId) ?? 0) + l.points);
      let scoredChanges = 0;
      for (const r of touched) {
        if (r.historyOnly || r.provisional) continue;
        if (Math.abs(round2(afterTotals.get(r.id) ?? 0) - round2(beforeTotals.get(r.id) ?? 0)) >= 0.001) scoredChanges++;
      }
      this.announceResults(touched);
      if (scoredChanges > 0) this.tx("score", null, `Live scoring: ${scoredChanges} result${scoredChanges === 1 ? "" : "s"} updated from ${m.name}`);
    }

    // Automatic FINAL only when the source clearly shows every listed event complete and nothing has changed for 30 minutes.
    if (!isGlobal && m.status === "LIVE" && m.polling && !m.isDemo && out.listedEvents.length > 0) {
      const done = out.listedEvents.every((id) => {
        const rowsFor = out.rows.filter((r) => r.sourceEventId === id);
        return rowsFor.length > 0 && rowsFor.every((r) => r.completeness !== "LIVE");
      });
      if (done && m.stats.lastChangeAt !== null && now - m.stats.lastChangeAt > AUTO_FINAL_QUIET_MS) {
        await this.finalizeMeet(m, null);
      }
    }
    if (!isGlobal && m.polling) m.nextSyncAt = now + (m.isDemo ? 8000 : POLL_MS);

    this.mirror("meets", [this.meetRow(m)]);
    this.mirrorMeetRows(m, out, analysis);
    const openRows = s.unmatched.filter((u) => u.meetId === m.id && openKeys.has(u.key));
    this.mirror("unmatched_results", openRows.map((u) => this.unmatchedRow(u)));
    return { changed, error: null };
  }

  private rowHashes: Map<string, Map<string, string>> = new Map();

  private mirrorMeetRows(m: Meet, out: NormalizeOutput, a: Analysis): void {
    if (!this.db.enabled) return;
    const s = this.require();
    const known = this.rowHashes.get(m.id) ?? new Map<string, string>();
    const rows: Record<string, unknown>[] = [];
    for (const r of out.rows) {
      const ids = a.rowIds.get(r.id) ?? [];
      const row = {
        id: `${s.id}:${hash(r.id)}`, meet_id: `${s.id}:${m.id}`, league_id: s.id, source_event_id: r.sourceEventId, event_name: r.eventName,
        event: r.event, race_id: r.raceId, round: r.round, heat: r.heat, athlete_source_id: r.athleteSourceId, bib: r.bib,
        athlete_name: r.athleteName, gender: r.gender, school: r.school, grade: r.grade, place: r.place, heat_place: r.heatPlace,
        mark: r.mark, splits: r.splits, result_status: r.resultStatus, completeness: r.completeness, seeded_count: r.seededCount,
        athlete_id: ids[0] ?? null, match_type: ids[0] ? a.matchType.get(ids[0]) ?? "mapping" : null, relevant: ids.some((id) => a.relevantIds.has(id)),
        is_demo: m.isDemo, updated_at: new Date(r.timestamp).toISOString(),
      };
      const h = hash(JSON.stringify({ ...row, updated_at: 0 }));
      if (known.get(r.id) === h) continue;
      known.set(r.id, h);
      rows.push(row);
    }
    this.rowHashes.set(m.id, known);
    this.mirror("meet_results", rows);
  }

  private async finalizeMeet(m: Meet, user: User | null): Promise<void> {
    const s = this.require();
    m.status = "FINAL";
    m.polling = false;
    m.nextSyncAt = null;
    if (m.scope !== "global" || m.finalAt === null) m.finalAt = Date.now();
    m.finalSeen = m.finalAt;
    const r = await this.syncMeet(m.id, { final: true });
    if (r.error) this.notify("Meet marked final", `${m.name} is final, but the last source check failed: ${r.error} Live results already posted were kept.`, "commish", [s.commissionerId], false);
    if (!m.isDemo && !m.history) {
      this.tx("score", null, `${m.name} results are final${user ? "" : " (source reported every event complete)"}`);
      this.notify(`${m.name} is final`, "All results are in. Check your matchup for the final breakdown.", "score", null, true, { key: `meetfinal:${m.id}:${m.finalAt}`, link: { type: "matchup", week: m.week } });
      // The matchup ends with its meet: once every meet of the current week is final (and processed above), the week closes.
      if (s.phase === "season" && m.week === s.week && this.openMeets(s.week).length === 0) this.finishWeek();
    }
  }

  /** TEST CONNECTION: the full production pipeline on the meet's real source, without saving anything. */
  private async testMeet(action: Record<string, unknown>): Promise<unknown> {
    return this.labRun(action, false);
  }

  /**
   * PROJECTIONS ONLY: last season's real Cornwall Central marks (the 2025-26 Armory meets on AthleticLIVE), read with the
   * production importer and matcher, stored apart from league results. Never scored, never a PB/SB source for real
   * points. Rebuilt weekly. Used when the Main League has no history of its own yet (preseason).
   */
  private async projectionLibrary(force = false): Promise<Result[]> {
    const list = await this.projMeetList();
    const sig = hash(JSON.stringify(list.map((m) => [m.id, m.date, m.name])));
    const idx = await this.ctx.storage.get<Omit<ProjLib, "byMeet">>("projlib:index");
    const load = async (): Promise<Result[]> => {
      const out: Result[] = [];
      for (const m of list) out.push(...((await this.ctx.storage.get<Result[]>(`projlib:m:${m.id}`)) ?? []));
      return out;
    };
    if (!force && idx && idx.sig === sig && Date.now() - idx.at < 7 * 86_400_000) return load();
    // Only one rebuild at a time; a second caller waits for the same run.
    if (!this.libBuild) this.libBuild = this.buildProjectionLibrary(list, sig, idx ?? null).finally(() => { this.libBuild = null; });
    await this.libBuild;
    return load();
  }

  private libBuild: Promise<void> | null = null;

  /** The meet list behind the projection library. The Main League starts with last season's 7 Armory meets. */
  private async projMeetList(): Promise<ProjMeet[]> {
    const stored = await this.ctx.storage.get<ProjMeet[]>("projmeets:list");
    if (stored) return stored;
    if (!this.isMain()) return [];
    return PROJECTION_LIBRARY_MEETS.map(([mid, date]) => ({
      id: `al-${mid}`, kind: "ATHLETICLIVE" as const, name: `Armory ${date}`, date, url: `https://live.athletic.net/meets/${mid}`, sourceMeetId: mid, builtin: true, addedAt: 0, by: "Built in",
    }));
  }

  /** Reads one projection meet with the production importer + matcher. Returns history-only rows (never scored). */
  private async readProjMeet(pm: ProjMeet): Promise<{ results: Result[]; rows: number; events: number; poolRows: number; name: string; date: string; skipped: number }> {
    const s = this.require();
    await this.loadLinks();
    const probe: Meet = {
      ...this.blankMeet(), id: `projlib-${pm.id}`, scope: "local", provider: pm.kind === "TEXT" ? "MANUAL" : "ATHLETICLIVE", name: pm.name, date: pm.date, week: 0, isDemo: false,
      history: true, sourceUrl: pm.url ?? "", sourceMeetId: pm.sourceMeetId ?? null,
    };
    let feed: RawFeed;
    let skipped = 0;
    if (pm.kind === "TEXT") {
      const text = (await this.ctx.storage.get<string>(`projmeets:text:${pm.id}`)) ?? "";
      const p = pastedToCsv(text);
      skipped = p.skipped;
      if (!p.csv) throw new SourceError("No results lines were recognized in the pasted text.", "format");
      feed = { events: "", roster: "", results: p.csv };
    } else {
      if (!pm.sourceMeetId) throw new SourceError("This AthleticLIVE link has no meet id.", "config");
      feed = (await fetchMeetFeed(probe)).feed;
    }
    const out = normalizeFeed(probe.id, feed, true, Date.now(), s.eventMap);
    const a = this.analyze(probe, out.rows);
    const results: Result[] = [];
    for (const r of this.buildLiveResults(probe, out, a, true).values()) {
      if (r && r.status === "OK" && !r.relay && r.provisional !== true) results.push({ ...r, historyOnly: true, meetId: null, best: "auto", week: 0 });
    }
    const poolRows = out.rows.filter((r) => !r.relay && isPoolSchool(r.school, r.teamId, r.region)).length;
    return { results, rows: out.rows.length, events: new Set(out.rows.map((r) => r.sourceEventId)).size, poolRows, name: pm.name, date: pm.date, skipped };
  }

  /** Rebuilds every projection meet. A meet that fails keeps its previous rows (the projections never go blank). */
  private async buildProjectionLibrary(list: ProjMeet[], sig: string, prev: Omit<ProjLib, "byMeet"> | null): Promise<void> {
    const stats: Record<string, ProjMeetStat> = {};
    for (const pm of list) {
      try {
        const got = await this.readProjMeet(pm);
        if (got.results.length === 0 && ((await this.ctx.storage.get<Result[]>(`projlib:m:${pm.id}`)) ?? []).length > 0) {
          stats[pm.id] = { ...(prev?.stats[pm.id] ?? { results: 0, athletes: 0 }), at: Date.now(), error: "Source returned no matched results; kept the previous copy.", kept: true };
          continue;
        }
        await this.ctx.storage.put(`projlib:m:${pm.id}`, got.results);
        stats[pm.id] = { at: Date.now(), results: got.results.length, athletes: new Set(got.results.flatMap((r) => r.athleteIds)).size, error: null };
      } catch (e) {
        const msg = e instanceof SourceError ? e.message : String(e).slice(0, 200);
        console.warn("projection library meet failed", pm.id, msg);
        const kept = ((await this.ctx.storage.get<Result[]>(`projlib:m:${pm.id}`)) ?? []).length > 0;
        stats[pm.id] = { ...(prev?.stats[pm.id] ?? { results: 0, athletes: 0 }), at: Date.now(), error: kept ? `${msg} Kept the previous copy.` : msg, kept };
      }
    }
    await this.ctx.storage.put("projlib:index", { at: Date.now(), sig, stats });
    await this.ctx.storage.delete("projlib:v1");
  }

  /** Tells the Directory (and so every league) that the shared projection history changed. */
  private async resetSharedProjectionHistory(): Promise<void> {
    await this.env.DO.fetch(new Request("https://internal/projection-history-reset", { method: "POST", headers: DIR_HEADERS, body: "{}" })).catch(() => null);
  }

  /** Builds a projection meet from a pasted link or pasted results text (validated, not saved). */
  private async projMeetFrom(a: Record<string, unknown>, by: string): Promise<{ pm: ProjMeet; text: string | null }> {
    const url = String(a.url ?? "").trim();
    const text = typeof a.text === "string" ? a.text.slice(0, 600_000) : "";
    if (url) {
      const r = await resolveAliveUrl(url);
      if (!r.meetId) {
        const why = r.steps[r.steps.length - 1]?.note ?? "No AthleticLIVE meet was found at that link.";
        throw new ActionError(`${why} Paste an AthleticLIVE meet link (…/meets/12345), or paste the results text instead.`);
      }
      const imp = await aliveImport(r.meetId, {});
      const date = /^\d{4}-\d{2}-\d{2}$/.test(imp.meta.date) ? imp.meta.date : String(a.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError("AthleticLIVE didn't publish this meet's date.");
      return { pm: { id: `al-${r.meetId}`, kind: "ATHLETICLIVE", name: imp.meta.name || `AthleticLIVE ${r.meetId}`, date, url: r.finalUrl || url, sourceMeetId: r.meetId, addedAt: Date.now(), by }, text: null };
    }
    if (!text.trim()) throw new ActionError("Paste a meet link or the meet's results text.");
    const name = String(a.name ?? "").trim().slice(0, 120);
    const date = String(a.date ?? "").trim();
    if (!name) throw new ActionError("Give the pasted meet a name.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError("Give the pasted meet a date (YYYY-MM-DD).");
    if (date > new Date().toISOString().slice(0, 10)) throw new ActionError("Projection meets must already have happened.");
    return { pm: { id: `tx-${hash(`${name}|${date}`).slice(0, 10)}`, kind: "TEXT", name, date, addedAt: Date.now(), by }, text };
  }

  private async projMeetsView(mode: "global" | "sandbox"): Promise<Record<string, unknown>> {
    const list = await this.projMeetList();
    const idx = await this.ctx.storage.get<Omit<ProjLib, "byMeet">>("projlib:index");
    const meets = list.map((m) => ({ ...m, stat: idx?.stats[m.id] ?? null })).sort((x, y) => y.date.localeCompare(x.date));
    return {
      ok: true, mode, shared: mode === "global",
      scopeNote: mode === "global" ? "Shared with every league. Projections only: these meets never score points or set PBs/SBs." : "This test league only. Projections only: these meets never score points or set PBs/SBs.",
      meets, builtAt: idx?.at ?? null,
      totals: { meets: list.length, results: meets.reduce((t, m) => t + (m.stat?.results ?? 0), 0), athletes: new Set((await this.projectionLibrary()).flatMap((r) => r.athleteIds)).size },
    };
  }

  /** Fingerprint of everything a lab run must never change (league state, results, scoring). */
  private isolationPrint(): string {
    return hash(JSON.stringify([this.state, [...this.results.keys()].sort(), this.linesHash, this.scoring]));
  }

  /**
   * MEET TEST LAB / TEST CONNECTION. Runs the exact production importer → normalizer → Cornwall matcher → result builder →
   * scoring engine on real source data, in memory only. Nothing is written to league state, results or links.
   */
  private async labRun(action: Record<string, unknown>, lab: boolean): Promise<Record<string, unknown>> {
    const s = this.require();
    const str = (k: string): string => String(action[k] ?? "").trim();
    const before = this.isolationPrint();
    const existing = str("meetId") ? s.meets.find((x) => x.id === str("meetId")) : undefined;
    const provider = (str("provider") || existing?.provider || "ATHLETICLIVE") as Provider;
    if ((provider as string) === "DEMO") return { ok: false, status: "FAIL", error: "Demo meets were removed. Paste a real meet link." };
    const sourceUrl = action.sourceUrl !== undefined ? str("sourceUrl") : existing?.sourceUrl ?? "";
    const fault = (["timeout", "5xx", "empty", "incomplete"].includes(str("fault")) ? str("fault") : null) as Fault | null;
    const probe: Meet = {
      ...(existing ?? this.blankMeet()),
      scope: existing?.scope === "global" && provider === "MANUAL" && typeof action.feedResults !== "string" ? "global" : "local",
      provider,
      name: str("name") || existing?.name || "Test meet",
      date: str("date") || existing?.date || "",
      eventsUrl: action.eventsUrl !== undefined ? str("eventsUrl") : existing?.eventsUrl ?? "",
      rosterUrl: action.rosterUrl !== undefined ? str("rosterUrl") : existing?.rosterUrl ?? "",
      resultsUrl: action.resultsUrl !== undefined ? str("resultsUrl") : existing?.resultsUrl ?? "",
      week: clampInt(action.week, 1, 30, existing?.week ?? s.week),
      isDemo: false,
      syncCount: 9,
      sourceMeetId: null,
    };
    const steps: SourceStep[] = [];
    const warnings: string[] = [];
    let imp: AliveImport | null = null;
    let meta: AliveImport["meta"] | null = null;
    let verify: { ok: boolean; problems: string[]; warnings: string[] } = { ok: true, problems: [], warnings: [] };
    let resolvedUrl = "";
    let feed: RawFeed;
    const run = async (f: Fault | null): Promise<{ feed: RawFeed; imp: AliveImport | null }> => {
      if (provider === "ATHLETICLIVE" && sourceUrl) {
        const r = await resolveAliveUrl(sourceUrl);
        steps.splice(0, steps.length, ...r.steps);
        resolvedUrl = r.finalUrl;
        if (r.meetId) return fetchMeetFeed({ ...probe, sourceMeetId: r.meetId }, { fault: f, steps, resolvedUrl: r.finalUrl });
        if (!probe.resultsUrl) {
          const chk = await checkSource(sourceUrl, { date: probe.date || undefined });
          steps.push(...chk.steps.filter((x) => !steps.includes(x)));
          if (!chk.ok) throw new SourceError(chk.message, "config");
          probe.eventsUrl = chk.eventsUrl; probe.rosterUrl = chk.rosterUrl; probe.resultsUrl = chk.resultsUrl;
        }
      } else if (provider === "ATHLETICLIVE" && existing?.sourceMeetId) {
        return fetchMeetFeed({ ...probe, sourceMeetId: existing.sourceMeetId }, { fault: f, steps });
      }
      if (provider === "ATHLETICLIVE" && !probe.resultsUrl) throw new SourceError("Paste the meet's public AthleticLIVE link (or an Advanced Results link).", "config");
      return { feed: await this.loadFeed(probe), imp: null };
    };
    try {
      const got = await run(null);
      feed = got.feed;
      imp = got.imp;
      if (imp) {
        meta = imp.meta;
        verify = verifyMeet(imp.meta, { date: probe.date || undefined, name: probe.name });
        warnings.push(...verify.warnings);
        if (!probe.date) probe.date = imp.meta.date;
        if (!existing || probe.name === "Test meet") probe.name = imp.meta.name;
        for (const m of imp.missing) warnings.push(`${m.event}: ${m.why}`);
        for (const r of imp.rejected) warnings.push(`Refused: ${r}`);
      }
    } catch (e) {
      const msg = e instanceof SourceError ? e.message : "Live source unavailable.";
      const kind = e instanceof SourceError ? e.kind : "unreachable";
      return {
        ok: false, status: "FAIL", error: msg, message: msg, temporary: kind === "unreachable", steps,
        hint: kind === "unreachable" ? "This looks temporary. Existing results are kept; try again in a minute."
          : "Check the link. If AthleticLIVE doesn't publish a dataset for this meet, add it under Advanced (Events / Roster / Results).",
        isolation: { unchanged: this.isolationPrint() === before },
      };
    }
    if (!verify.ok) {
      return { ok: false, status: "FAIL", error: verify.problems.join(" "), message: verify.problems.join(" "), steps, source: meta, isolation: { unchanged: this.isolationPrint() === before } };
    }
    await this.loadLinks();
    const scoringVersion = this.global?.scoringVersion ?? 0;
    const pipeline = (fd: RawFeed): { out: NormalizeOutput; a: Analysis; built: Map<string, Result | null>; lines: Line[]; results: Result[] } => {
      const out = normalizeFeed(probe.id, fd, false, Date.now(), s.eventMap);
      probe.fieldProfile = this.profileOf(probe, out.rows);
      const a = this.analyze(probe, out.rows);
      const built = this.buildLiveResults(probe, out, a, false);
      const results = [...built.values()].filter((r): r is Result => !!r);
      const ids = new Set(results.map((r) => r.id));
      const others = [...this.results.values()].filter((r) => r.meetId !== probe.id);
      const lines = results.length > 0 ? computeAll(this.scoringInput([...others, ...results])).lines.filter((l) => ids.has(l.sourceId)) : [];
      return { out, a, built, lines, results };
    };
    const main = pipeline(feed);
    const { out, a, built, lines } = main;
    const totalOf = (ls: Line[]): number => round2(ls.reduce((t, l) => t + l.points, 0));
    const print = (p: typeof main): Record<string, unknown> => ({
      rows: p.out.rows.length,
      events: new Set(p.out.rows.map((r) => r.sourceEventId)).size,
      results: p.results.length,
      matches: hash(JSON.stringify([...p.a.rowIds.entries()].filter(([, v]) => v.length > 0).sort())),
      points: totalOf(p.lines),
      lines: hash(JSON.stringify(p.lines.map((l) => [l.id, l.points]).sort())),
    });

    // Events (complete field: every school, every heat/flight).
    const byEvent = new Map<string, { name: string; event: string | null; gender: string | null; kind: string; round: string; heats: number; rows: number; fieldSize: number | null; complete: boolean; cornwall: number; sourceFinal: boolean | null }>();
    for (const r of out.rows) {
      const cur = byEvent.get(r.sourceEventId) ?? {
        name: r.eventName, event: r.event, gender: r.gender, kind: r.relay ? "relay" : r.event ? eventInfo(r.event).kind : "unknown", round: r.round,
        heats: r.heats ?? 0, rows: 0, fieldSize: r.seededCount, complete: true, cornwall: 0, sourceFinal: r.sourceFinal ?? null,
      };
      cur.rows++;
      if (r.completeness === "LIVE") cur.complete = false;
      if (isPoolSchool(r.school, r.teamId, r.region)) cur.cornwall++;
      byEvent.set(r.sourceEventId, cur);
    }
    const recognized = out.rows.filter((r) => r.event).length;

    // Evidence per Cornwall Central athlete (and every matched athlete).
    const evidence: Record<string, unknown>[] = [];
    const rawOf = (ref: string | undefined): unknown => {
      if (!ref || !imp) return null;
      const v = imp.raw[ref] as Record<string, unknown> | undefined;
      if (!v) return { ref };
      const { lg: _lg, fsu: _f, tsu: _t, ith: _i, iu: _u, ...rest } = v;
      return { ref, ...rest };
    };
    const resultOf = (r: NormalizedMeetResult): Record<string, unknown> => {
      const res = built.get(r.id) ?? null;
      return {
        meet: probe.name, sourceEvent: r.eventName, event: r.event, gender: r.gender, type: r.relay ? "relay" : r.event ? eventInfo(r.event).kind : "unknown",
        round: r.round, heat: r.heat, heats: r.heats ?? null, heatPlace: r.heatPlace, place: r.place, livePlace: r.livePlace, mark: r.mark, status: r.resultStatus,
        fieldSize: res?.seeded ?? r.seededCount, eventFieldSize: r.seededCount, seedMark: r.seedMark ?? "", wind: r.wind ?? "", sourcePb: r.srcPb ?? "", sourceSb: r.srcSb ?? "",
        completeness: r.completeness, sourceFinal: r.sourceFinal ?? null, best: res?.best ?? null, provisional: res?.provisional ?? false, historyOnly: res?.historyOnly ?? false,
      };
    };
    const scoringOf = (r: NormalizedMeetResult, athleteId: string | null): Record<string, unknown> => {
      const res = built.get(r.id);
      const ls = res && athleteId ? lines.filter((l) => l.sourceId === res.id && l.athleteId === athleteId) : [];
      return { scoringVersion, lines: ls.map((l) => ({ code: l.code, label: l.label, points: l.points, basis: l.basis ?? "", ver: l.ver ?? "" })), total: totalOf(ls), resultId: res?.id ?? null };
    };
    for (const r of out.rows) {
      if (r.relay) {
        if (!isPoolSchool(r.school, r.teamId, r.region)) continue;
        const ids = a.rowIds.get(r.id) ?? [];
        evidence.push({
          kind: "relay",
          source: { name: `${r.school} ${r.relayDesig ? `(${r.relayDesig})` : ""}`.trim(), school: r.school, teamId: r.teamId ?? null, members: r.relayMembers.map((m) => `${m.first} ${m.last}`.trim()) },
          master: null,
          relayMembers: ids.map((id) => ({ id, name: this.nameOf(id), ...scoringOf(r, id) })),
          match: { type: ids.length ? "relay_members" : "review", confidence: ids.length ? "high" : "none", reason: ids.length ? `Relay legs matched: ${this.names(ids)}` : r.relayMembers.length ? "No relay leg matched a master player." : "Relay legs aren't published; needs review.", candidates: [] },
          result: resultOf(r),
          scoring: ids[0] ? scoringOf(r, ids[0]) : { scoringVersion, lines: [], total: 0, resultId: built.get(r.id)?.id ?? null },
          raw: rawOf(r.sourceRef),
        });
        continue;
      }
      const key = a.rowSrc.get(r.id) ?? "";
      const ev = a.evidence.get(key);
      if (!ev) continue;
      if (!ev.match.inPool && !ev.match.athleteId) continue;
      const id = ev.match.athleteId;
      const mAth = id ? this.maybeAthlete(id) : undefined;
      evidence.push({
        kind: "individual",
        source: { sourceId: ev.src.sourceId ?? null, name: `${ev.src.first} ${ev.src.last}`.trim(), school: ev.src.school, gender: ev.src.gender, grade: ev.src.grade ?? "", bib: ev.src.bib ?? "", teamId: ev.src.teamId ?? null },
        master: mAth ? { id: mAth.id, name: mAth.name, school: poolSchoolOf(mAth.school), positions: mAth.positions } : null,
        match: { type: ev.match.type, confidence: ev.match.confidence, reason: ev.match.reason, candidates: ev.match.candidates.map((c) => ({ id: c, name: this.nameOf(c) })) },
        result: resultOf(r),
        scoring: scoringOf(r, id),
        raw: rawOf(r.sourceRef),
      });
    }
    const pool = [...a.evidence.values()].filter((e) => e.match.inPool);
    const matchedPool = pool.filter((e) => !!e.match.athleteId).length;
    const review = pool.filter((e) => e.match.type === "review").length;
    const conflicts = [...a.evidence.values()].filter((e) => e.match.type === "conflict").length;
    const unmatchedPool = pool.filter((e) => e.match.type === "none").length;
    const rawRows = feed.results.trim() ? Math.max(0, parseCsv(feed.results).length - 1) : 0;
    const dupIds = out.rows.length - new Set(out.rows.map((r) => r.id)).size;
    const empty = out.format === "empty";
    if (out.unknownEvents.length) warnings.push(`Events not recognized (not scored): ${out.unknownEvents.map((u) => u.eventName).slice(0, 12).join(", ")}`);
    if (review) warnings.push(`${review} Cornwall Central athlete${review === 1 ? "" : "s"} need review before any points (ambiguous name).`);
    if (conflicts) warnings.push(`${conflicts} SOURCE ID CONFLICT${conflicts === 1 ? "" : "S"}: no points until reviewed.`);
    if (unmatchedPool) warnings.push(`${unmatchedPool} Cornwall Central athlete${unmatchedPool === 1 ? " isn't" : "s aren't"} in the player database (no points).`);

    const checks = [
      { name: "Meet identified", ok: !!meta || provider !== "ATHLETICLIVE" || !!probe.resultsUrl, detail: meta ? `${meta.name} · ${meta.date} · ${meta.location}` : "Advanced / pasted feed" },
      { name: "Source verified as this meet", ok: verify.ok, detail: meta ? `AthleticLIVE meet ${meta.id}; every result document carried that meet id` : "Advanced link" },
      { name: "Events imported", ok: byEvent.size > 0 && recognized > 0, detail: `${byEvent.size} events, ${recognized} recognized results` },
      { name: "Athletes imported", ok: a.sourceAthletes > 0, detail: `${a.sourceAthletes} athletes from every school` },
      { name: "Cornwall Central athletes identified", ok: a.poolAthletes > 0, detail: `${a.poolAthletes} Cornwall Central athletes` },
      { name: "Matched to master players", ok: matchedPool > 0, detail: `${matchedPool} matched${review ? `, ${review} review` : ""}${conflicts ? `, ${conflicts} conflicts` : ""}` },
      { name: "Real results imported", ok: out.rows.length > 0, detail: `${out.rows.length} results` },
      { name: "Fantasy points calculated", ok: lines.length > 0, detail: `${lines.length} scoring lines, ${totalOf(lines)} pts` },
      { name: "No duplicate results", ok: dupIds === 0, detail: `${rawRows - out.rows.length} duplicate rows merged` },
    ];
    const allOk = checks.every((c) => c.ok);
    const status = empty ? "WARNINGS" : !allOk ? "FAIL" : warnings.length > 0 ? "WARNINGS" : "PASS";
    const firstFail = checks.find((c) => !c.ok);
    const sampleRow = evidence.find((e) => (e.scoring as { total?: number }).total);

    const result: Record<string, unknown> = {
      ok: empty || allOk, status, scoringReady: allOk, temporary: false,
      message: empty ? "Meet found. No results are posted yet, so scoring can't be verified until they are."
        : allOk ? `Verified: ${out.rows.length} real results, ${a.poolAthletes} Cornwall athletes, ${matchedPool} matched, ${totalOf(lines)} fantasy points.`
        : `Not ready: ${firstFail?.name ?? "check failed"} (${firstFail?.detail ?? ""}).`,
      problem: allOk ? null : firstFail ? `${firstFail.name}: ${firstFail.detail}` : null,
      source: {
        publicUrl: sourceUrl, resolvedUrl, meetId: meta?.id ?? null, name: meta?.name ?? null, date: meta?.date ?? null, location: meta?.location ?? null,
        region: meta?.region ?? null, timer: meta?.timer ?? null, sourceType: imp ? `AthleticLIVE public data (${imp.method})` : provider === "MANUAL" ? "Pasted feed" : "Advanced links",
        athleticNetMeets: meta?.athleticNetMeets ?? [],
        advanced: { events: !!probe.eventsUrl, roster: !!probe.rosterUrl, results: !!probe.resultsUrl },
      },
      steps, checks, warnings, capabilities: imp?.caps ?? null,
      counts: {
        events: byEvent.size, athletes: a.sourceAthletes, results: out.rows.length, cornwall: a.poolAthletes, matched: matchedPool, review, conflicts,
        unmatched: unmatchedPool, rejected: imp?.rejected.length ?? 0, missingEvents: imp?.missing.length ?? 0, duplicatesPrevented: Math.max(0, rawRows - out.rows.length),
        scoringLines: lines.length, points: totalOf(lines),
      },
      events: [...byEvent.values()].slice(0, 150),
      evidence: lab
        ? evidence.slice(0, 250).map((e) => ({ ...e, rawText: e.raw ? JSON.stringify(e.raw, null, 1).slice(0, 4000) : null }))
        : evidence.filter((e) => (e.master as unknown) !== null).slice(0, 30).map(({ raw: _r, ...e }) => e),
      // Older app fields.
      format: out.format, results: out.rows.length, feedEvents: out.listedEvents.length, sourceAthletes: a.sourceAthletes, matched: matchedPool, relevant: a.relevantIds.size,
      needsReview: a.weak.size, unknownEvents: out.unknownEvents.map((u) => u.eventName), recognizedResults: recognized,
      relevantNames: [...a.relevantIds].slice(0, 20).map((id) => this.nameOf(id)),
      sample: sampleRow ? { athlete: (sampleRow.master as { name?: string } | null)?.name ?? "", lines: (sampleRow.scoring as { lines: unknown[] }).lines, total: (sampleRow.scoring as { total: number }).total } : null,
      fingerprint: print(main),
    };

    if (lab && action.repeat === true && imp) {
      const runs = [print(main)];
      for (let i = 0; i < 2; i++) {
        try { runs.push(print(pipeline((await run(null)).feed))); } catch (e) { runs.push({ error: e instanceof Error ? e.message : "failed" }); }
      }
      const same = runs.every((r) => JSON.stringify(r) === JSON.stringify(runs[0]));
      result.repeat = { runs, identical: same, verdict: same ? "PASS: three imports gave identical events, results, matches and points." : "FAIL: imports differed." };
    }
    if (lab && action.reconcile === true && feed.results.trim()) {
      // Live state derived from the real final results: every event unofficial, every other row not yet posted.
      const rows = parseCsv(feed.results);
      const head = rows[0] ?? [];
      const ci = (n: string): number => head.indexOf(n);
      const q = (v: string): string => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const seen = new Map<string, number>();
      const partial = [head.join(","), ...rows.slice(1).map((r) => {
        const c = [...r];
        const ev = c[ci("EventId")] ?? "";
        const n = (seen.get(ev) ?? 0) + 1;
        seen.set(ev, n);
        c[ci("Final")] = "N";
        if (n % 2 === 0) { c[ci("Place")] = ""; c[ci("HeatPlace")] = ""; c[ci("Result")] = ""; c[ci("Status")] = ""; }
        return c.map(q).join(",");
      })].join("\n");
      const live = pipeline({ ...feed, results: partial });
      // Same apply rules as syncMeet: one result per source identity; a row the final data drops (e.g. DNS) is removed.
      const merged = new Map<string, Result>();
      for (const r of live.results) merged.set(r.id, r);
      const liveIds = new Set(live.results.map((r) => r.id));
      let replaced = 0;
      let removed = 0;
      for (const [rowId, next] of main.built) {
        const id = `live${hash(rowId)}`;
        if (!next) { if (merged.delete(id)) removed++; continue; }
        if (liveIds.has(id)) replaced++;
        merged.set(id, next);
      }
      const finalIds = new Set(main.results.map((r) => r.id));
      const orphans = [...merged.keys()].filter((id) => !finalIds.has(id));
      const others = [...this.results.values()].filter((r) => r.meetId !== probe.id);
      const mergedLines = computeAll(this.scoringInput([...others, ...merged.values()])).lines.filter((l) => merged.has(l.sourceId));
      const ok = orphans.length === 0 && merged.size === main.results.length && Math.abs(totalOf(mergedLines) - totalOf(lines)) < 0.001;
      result.reconcile = {
        liveResults: live.results.length, liveProvisional: live.results.filter((r) => r.provisional).length, livePoints: totalOf(live.lines),
        finalResults: main.results.length, replacedInPlace: replaced, removedByFinal: removed, orphans: orphans.length, afterFinal: merged.size, finalPoints: totalOf(lines), mergedPoints: totalOf(mergedLines),
        verdict: ok ? "PASS: final results replaced the live ones in place; no duplicates; totals equal the final state." : "FAIL: live and final didn't reconcile cleanly.",
      };
    }
    if (lab && fault && imp) {
      try {
        const bad = await aliveImport(imp.meta.id, { fault });
        const why = fault === "incomplete" ? incompleteImport(bad, imp.caps.resultRows) : null;
        result.fault = why
          ? { fault, outcome: "temporary failure detected", message: why, lastGoodKept: true, pointsDeleted: 0, verdict: "PASS: incomplete data was refused; the last complete copy stays." }
          : { fault, outcome: "no failure detected", verdict: "FAIL: the simulated failure wasn't caught." };
      } catch (e) {
        const temp = e instanceof SourceError && e.kind === "unreachable";
        result.fault = { fault, outcome: temp ? "temporary failure" : "error", message: e instanceof Error ? e.message : String(e), lastGoodKept: true, pointsDeleted: 0, retries: 3,
          verdict: temp ? "PASS: reported as temporary; nothing was overwritten or deleted, and the next poll retries." : "FAIL: not reported as temporary." };
      }
    }
    const after = this.isolationPrint();
    result.isolation = { before, after, unchanged: before === after };
    if (lab) {
      const runs = ((await this.ctx.storage.get<Record<string, unknown>[]>("lab:runs")) ?? []).filter((r) => Date.now() - Number(r.at ?? 0) < 14 * 86_400_000);
      runs.unshift({ at: Date.now(), url: sourceUrl, meet: meta?.name ?? probe.name, date: meta?.date ?? probe.date, status, counts: result.counts, isolation: result.isolation });
      await this.ctx.storage.put("lab:runs", runs.slice(0, 12));
      // Real Cornwall results from this run feed the scoring-change preview ("old score → new score" on real data).
      const keep = main.results.filter((r) => !r.historyOnly).slice(0, 400);
      await this.ctx.storage.put("lab:lastResults", { meet: meta?.name ?? probe.name, date: meta?.date ?? probe.date, results: keep });
    }
    return result;
  }

  private blankMeet(): Meet {
    const s = this.require();
    return {
      id: uid(), name: "", date: "", week: s.week, provider: "ATHLETICLIVE", status: "UPCOMING", eventsUrl: "", rosterUrl: "", resultsUrl: "",
      isDemo: false, polling: false, createdAt: Date.now(), startedAt: null, finalAt: null, lastSyncedAt: null, lastAttemptAt: null,
      nextSyncAt: null, syncCount: 0, sourceError: null, sourceErrorAt: null, failures: 0, stats: emptyStats(), demo: null,
    };
  }

  private applyMeetFields(m: Meet, action: Record<string, unknown>): void {
    const s = this.require();
    const str = (k: string): string => String(action[k] ?? "").trim();
    const has = (k: string): boolean => action[k] !== undefined;
    if (has("name")) m.name = str("name").slice(0, 60);
    if (has("date")) {
      const d = str("date");
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ActionError("Enter the meet date.");
      m.date = d;
    }
    if (has("week")) m.week = clampInt(action.week, 1, Math.max(1, this.totalWeeks() || this.st().regularWeeks), s.week);
    if (has("provider")) {
      const p = str("provider").toUpperCase();
      if (p === "DEMO") throw new ActionError("Demo meets were removed. Use the Meet Test Lab to try a real past meet.");
      m.provider = p === "MANUAL" ? "MANUAL" : "ATHLETICLIVE";
      m.isDemo = false;
    }
    if (has("sourceUrl")) {
      const v = str("sourceUrl").slice(0, 800);
      if (v && !/^https?:\/\//i.test(v)) throw new ActionError("The meet link must start with https://");
      if (v !== (m.sourceUrl ?? "")) m.resolve = null;
      m.sourceUrl = v;
    }
    for (const k of ["eventsUrl", "rosterUrl", "resultsUrl"] as const) {
      if (!has(k)) continue;
      const v = str(k).slice(0, 800);
      if (v && !/^https?:\/\//i.test(v)) throw new ActionError("Source URLs must start with https://");
      m[k] = v;
    }
    if (!m.name) throw new ActionError("Enter the meet name.");
  }

  // MARK: - Settings

  private applySettings(a: Record<string, unknown>): void {
    const s = this.require();
    const st = s.settings;
    const pre = s.phase === "predraft";
    const has = (k: string): boolean => a[k] !== undefined;
    if (has("pickSeconds")) st.pickSeconds = clampInt(a.pickSeconds, 15, 3600, st.pickSeconds);
    if (pre) {
      if (has("maxTeams")) st.maxTeams = clampInt(a.maxTeams, Math.max(2, s.teams.length), 14, st.maxTeams);
      if (has("regularWeeks")) st.regularWeeks = clampInt(a.regularWeeks, 1, 20, st.regularWeeks);
      if (has("playoffTeams")) st.playoffTeams = [0, 2, 4, 6, 8].includes(Number(a.playoffTeams)) ? Number(a.playoffTeams) : st.playoffTeams;
      if (has("draftAt")) {
        const next = a.draftAt === null || a.draftAt === 0 ? null : clampInt(a.draftAt, Date.now() - DAY, Date.now() + 365 * DAY, Date.now());
        if (next !== st.draftAt) {
          if (st.draftAt !== null && st.draftAt - Date.now() < DRAFT_EDIT_CUTOFF_MS) {
            throw new ActionError("The draft time is locked 30 minutes before the draft. Use Start Draft Now if everyone's ready.");
          }
          if (next !== null && next - Date.now() < DRAFT_EDIT_CUTOFF_MS) {
            throw new ActionError("Pick a draft time at least 30 minutes from now.");
          }
          st.draftAt = next;
          if (next !== null) this.notify("Draft time set", `The draft starts ${new Date(next + st.tzOffsetMin * 60_000).toISOString().slice(0, 16).replace("T", " at ")}.`, "draft", this.others(s.commissionerId));
        }
      }
      if (has("draftOrderMode")) st.draftOrderMode = a.draftOrderMode === "manual" ? "manual" : "random";
      if (has("faabBudget")) {
        st.faabBudget = clampInt(a.faabBudget, 0, 1000, st.faabBudget);
        for (const t of s.teams) t.faab = st.faabBudget;
      }
    }
    if (s.phase !== "complete" && !(s.bracket?.seeded ?? false)) {
      if (has("consolation")) st.consolation = a.consolation === true;
      if (has("tiebreaker")) st.tiebreaker = a.tiebreaker === "h2h" ? "h2h" : "pf";
    }
    if (has("waiverType") && (pre || Object.keys(s.waivers).length === 0)) st.waiverType = a.waiverType === "faab" ? "faab" : "rolling";
    if (has("waiverDays")) st.waiverDays = clampInt(a.waiverDays, 0, 7, st.waiverDays);
    if (has("waiverHour")) st.waiverHour = clampInt(a.waiverHour, 0, 23, st.waiverHour);
    if (has("tzOffsetMin")) st.tzOffsetMin = clampInt(a.tzOffsetMin, -720, 840, st.tzOffsetMin);
    if (has("maxAddsPerWeek")) st.maxAddsPerWeek = clampInt(a.maxAddsPerWeek, 0, 20, st.maxAddsPerWeek);
    if (has("tradeReview")) st.tradeReview = a.tradeReview === "none" ? "none" : a.tradeReview === "league" ? "league" : "commish";
    if (has("tradeReviewDays")) st.tradeReviewDays = clampInt(a.tradeReviewDays, 0, 3, st.tradeReviewDays);
    if (has("vetoVotes")) st.vetoVotes = clampInt(a.vetoVotes, 1, 13, st.vetoVotes);
    if (has("tradeDeadlineWeek")) st.tradeDeadlineWeek = clampInt(a.tradeDeadlineWeek, 0, 20, st.tradeDeadlineWeek);
    if (has("lineupLock")) st.lineupLock = a.lineupLock === "manual" ? "manual" : "results";
  }

  private assertCommish(user: User): void {
    if (this.require().commissionerId !== user.id) throw new ActionError("Only the commissioner can do that.");
  }

  // MARK: - Actions

  private async handleAction(user: User, action: Record<string, unknown>): Promise<void> {
    const s = this.require();
    const type = String(action.type ?? "");
    const str = (k: string): string => String(action[k] ?? "").trim();
    const strs = (k: string): string[] => (Array.isArray(action[k]) ? (action[k] as unknown[]).map(String) : []);
    const inSeason = (): void => { if (s.phase !== "season") throw new ActionError("That opens once the season starts."); };

    // Global Fantasy T&F configuration: only the Main League commissioner, checked by the Directory on every request.
    if (type === "setMainLeague" || type === "changeMainLeague" || action.isMainLeague !== undefined || action.mainLeagueId !== undefined) {
      throw new ForbiddenError("The Main League is fixed and can't be changed.");
    }
    if (type === "createMeet" && action.testMeet === true) {
      // Rehearsal meet in a throwaway test league: real AthleticLIVE data through the same importer and engine.
      if (this.isMain()) throw new ActionError("Rehearsal meets can't run in the Main League.");
    } else if (GLOBAL_ACTIONS.has(type)) {
      const meetId = str("meetId");
      const local = meetId ? s.meets.find((m) => m.id === meetId && m.scope !== "global") : undefined;
      if (local?.testMeet) {
        // Rehearsal meet in a throwaway test league: runs locally through the same importer and engine.
        if (this.isMain()) throw new ActionError("Rehearsal meets can't run in the Main League.");
      } else if (local) {
        // An old league-only meet: it keeps its points, but it no longer runs. It can only be removed.
        if (type !== "deleteMeet") throw new ActionError(`${local.name} is an archived league-only meet. Meets are set by the Main League now.`);
      } else {
        if (!this.global) throw new ActionError("Global settings couldn't be loaded. Try again.");
        await this.forwardGlobal(user, action);
        return;
      }
    }
    // Player info (name, school, positions, status, photo) lives in the master player database: Main League only.
    if (MASTER_ACTIONS.has(type)) {
      this.assertCommish(user);
      if (!this.global) throw new ActionError("Global settings couldn't be loaded. Try again.");
      await this.forwardMaster(user, action);
      return;
    }

    switch (type) {
      case "resetDraft": {
        if (action.confirm !== "RESET") throw new ActionError("Confirm the draft reset first.");
        await this.resetDraft(user);
        return;
      }

      case "reorderClaims": {
        const mine = this.myTeam(user).id;
        const ids = strs("claimIds");
        const pending = s.claims.filter((c) => c.teamId === mine && c.status === "pending");
        if (ids.length !== pending.length || !pending.every((c) => ids.includes(c.id))) throw new ActionError("Your claims changed. Refresh and try again.");
        for (const c of pending) c.rank = ids.indexOf(c.id) + 1;
        return;
      }

      case "renameTeam": {
        const t = this.myTeam(user);
        t.teamName = this.cleanTeamName(str("teamName"), t.ownerName);
        return;
      }

      case "updateSettings": {
        this.assertCommish(user);
        const g = this.global?.settings;
        const globalPart: Record<string, unknown> = {};
        for (const k of GLOBAL_SETTING_KEYS) if (action[k] !== undefined && (!g || action[k] !== g[k])) globalPart[k] = action[k];
        if (Object.keys(globalPart).length > 0) {
          if (!this.isMain()) throw new ForbiddenError(`${Object.keys(globalPart).join(", ")} ${Object.keys(globalPart).length === 1 ? "is" : "are"} set by the Main League. Only the Main League commissioner can change ${Object.keys(globalPart).length === 1 ? "it" : "them"}.`);
          await this.forwardGlobal(user, { type: "updateGlobalSettings", settings: globalPart });
        }
        const name = str("name");
        if (name) {
          s.name = name.slice(0, 40);
          this.ctx.waitUntil(
            this.env.DO.fetch(new Request("https://internal/rename", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Rork-DO-Class": "Directory", "X-Rork-DO-Id": "global" },
              body: JSON.stringify({ leagueId: s.id, name: s.name }),
            })).catch(() => undefined),
          );
        }
        this.applySettings(action);
        this.tx("commish", null, "The commissioner updated league settings");
        return;
      }

      case "randomizeOrder": {
        this.assertCommish(user);
        if (s.phase !== "predraft") throw new ActionError("The draft already started.");
        const order = s.teams.map((t) => t.id);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j] as string, order[i] as string];
        }
        s.draft.order = order;
        s.settings.draftOrderMode = "manual";
        for (const [i, id] of order.entries()) this.notify("Draft order is set", `You pick #${i + 1} of ${order.length}.`, "draft", [id]);
        return;
      }

      case "setOrder": {
        this.assertCommish(user);
        if (s.phase !== "predraft") throw new ActionError("The draft already started.");
        const order = strs("order");
        const ids = new Set(s.teams.map((t) => t.id));
        if (order.length !== ids.size || !order.every((id) => ids.has(id))) throw new ActionError("Order must include every team once.");
        s.draft.order = order;
        s.settings.draftOrderMode = "manual";
        return;
      }

      case "startDraft": {
        this.assertCommish(user);
        if (s.phase !== "predraft") throw new ActionError("The draft already started.");
        this.startDraft();
        return;
      }

      case "pauseDraft": {
        this.assertCommish(user);
        if (s.draft.status !== "live" || s.draft.deadline === null) throw new ActionError("The draft isn't running.");
        s.draft.status = "paused";
        s.draft.pausedRemaining = Math.max(5000, s.draft.deadline - Date.now());
        s.draft.deadline = null;
        this.notify("Draft paused", "The commissioner paused the draft.", "draft", this.others(user.id), false);
        return;
      }

      case "resumeDraft": {
        this.assertCommish(user);
        if (s.draft.status !== "paused") throw new ActionError("The draft isn't paused.");
        s.draft.status = "live";
        s.draft.deadline = Date.now() + (s.draft.pausedRemaining ?? this.st().pickSeconds * 1000);
        s.draft.pausedRemaining = null;
        this.notify("Draft resumed", "The clock is running again.", "draft", this.others(user.id));
        return;
      }

      case "setQueue": {
        const t = this.myTeam(user);
        const taken = new Set(s.teams.flatMap((x) => this.rosterOf(x)));
        t.queue = [...new Set(strs("ids"))].filter((id) => this.maybeAthlete(id) && !taken.has(id)).slice(0, 40);
        return;
      }

      case "pick": {
        if (s.phase !== "drafting" || s.draft.status !== "live") throw new ActionError("The draft isn't live.");
        const onClock = this.teamOnClock();
        if (!onClock) throw new ActionError("Nobody is on the clock.");
        if (!this.canManageTeam(user.id, onClock)) throw new ActionError("It's not your pick.");
        if (action.pickNumber !== undefined && Number(action.pickNumber) !== s.draft.picks.length + 1) {
          throw new ActionError("That pick was already made. The board has been refreshed.");
        }
        const athleteId = str("athleteId") || this.autoPickFor(onClock);
        if (!athleteId) throw new ActionError("No athletes left.");
        this.makePick(onClock, athleteId, action.auto === true);
        return;
      }

      case "moveAthlete": {
        inSeason();
        this.assertUnlocked();
        const team = this.myTeam(user);
        const aid = str("athleteId");
        const slot = str("slot") as SlotId;
        if (!SLOT_IDS.includes(slot)) throw new ActionError("Unknown roster spot.");
        const from = SLOT_IDS.find((x) => team.lineup[x] === aid);
        if (!from) throw new ActionError("That athlete isn't on your roster.");
        if (from === slot) return;
        const a = this.athlete(aid);
        this.assertNotLocked([aid, team.lineup[slot]]);
        if (!this.eligible(a, slot)) throw new ActionError(slot === "IR" ? `${a.name} isn't listed IR or Out, so they can't go in the IR spot.` : `${a.name} can't play ${slot}.`);
        const other = team.lineup[slot];
        if (other && !this.eligible(this.athlete(other), from)) throw new ActionError(from === "IR" ? `${this.nameOf(other)} isn't listed IR or Out, so they can't swap into IR. Move them to an open spot instead.` : `${this.nameOf(other)} can't move to ${from.startsWith("BN") ? "BN" : from}.`);
        team.lineup[slot] = aid;
        team.lineup[from] = other;
        return;
      }

      case "setLineup": {
        inSeason();
        this.assertUnlocked();
        const team = this.myTeam(user);
        const raw = (action.lineup ?? {}) as Record<string, unknown>;
        const next = emptyLineup();
        for (const slot of SLOT_IDS) {
          const v = raw[slot];
          next[slot] = typeof v === "string" && v ? v : null;
        }
        const placed = SLOT_IDS.map((x) => next[x]).filter((x): x is string => !!x);
        const roster = this.rosterOf(team);
        if (placed.length !== new Set(placed).size || placed.length !== roster.length || !placed.every((id) => roster.includes(id))) {
          throw new ActionError("Your roster changed. Refresh and try again.");
        }
        for (const slot of SLOT_IDS) {
          const id = next[slot];
          if (!id || this.eligible(this.athlete(id), slot)) continue;
          if (slot === "IR" && team.lineup.IR === id) continue;
          throw new ActionError(slot === "IR" ? `Only players listed IR or Out can go in the IR spot.` : `${this.nameOf(id)} can't play ${slot}.`);
        }
        // A stale phone can't move a locked player: every locked athlete must stay exactly where they are.
        const lockedNow = this.lockedIds();
        for (const slot of SLOT_IDS) {
          const cur = team.lineup[slot];
          if (cur && lockedNow.has(cur) && next[slot] !== cur) throw new ActionError(this.lockMessage(cur));
        }
        team.lineup = next;
        return;
      }

      case "optimizeLineup": {
        inSeason();
        this.assertUnlocked();
        const team = this.myTeam(user);
        const lockedNow = this.lockedIds();
        const fixed = emptyLineup();
        for (const slot of SLOT_IDS) {
          const id = team.lineup[slot];
          if (id && lockedNow.has(id)) fixed[slot] = id;
        }
        const ir = team.lineup.IR;
        const pool = this.rosterOf(team).filter((id) => id !== ir && !lockedNow.has(id));
        const value = (id: string): number => this.seasonPoints(id) + (this.athleteWeek(id, s.week) * 2);
        let best: { score: number; pick: Record<string, string> } = { score: -Infinity, pick: {} };
        const starters: SlotId[] = (["SPR", "DIS", "FLD", "FLEX"] as SlotId[]).filter((x) => !fixed[x]);
        const walk = (i: number, used: Set<string>, pick: Record<string, string>, score: number): void => {
          if (i === starters.length) {
            if (score > best.score) best = { score, pick: { ...pick } };
            return;
          }
          const slot = starters[i] as SlotId;
          let any = false;
          for (const id of pool) {
            if (used.has(id) || !this.eligible(this.athlete(id), slot)) continue;
            any = true;
            used.add(id);
            pick[slot] = id;
            walk(i + 1, used, pick, score + value(id) + 1000);
            used.delete(id);
            delete pick[slot];
          }
          if (!any || true) walk(i + 1, used, pick, score);
        };
        walk(0, new Set(), {}, 0);
        const next: Record<SlotId, string | null> = { ...fixed };
        next.IR = ir;
        for (const slot of starters) next[slot] = best.pick[slot] ?? null;
        const benched = pool.filter((id) => !Object.values(best.pick).includes(id));
        const openBench = (["BN1", "BN2"] as SlotId[]).filter((x) => !fixed[x]);
        if (benched.length > openBench.length) throw new ActionError("Couldn't fit everyone — move someone to Injured first.");
        openBench.forEach((slot, i) => { next[slot] = benched[i] ?? null; });
        team.lineup = next;
        return;
      }

      case "setStatus": {
        this.assertCommish(user);
        const a = this.athlete(str("athleteId"));
        const raw = str("status");
        const next: AthStatus = raw === "Q" || raw === "O" || raw === "IR" ? raw : "active";
        const prev: AthStatus = a.status ?? "active";
        if (prev === next) return;
        a.status = next;
        this.audit(user, "athlete.status", `${a.name}: ${STATUS_LABEL[prev]} → ${STATUS_LABEL[next]}`);
        this.tx("status", null, `${a.name} is now listed as ${STATUS_LABEL[next]}`, [a.id]);
        const owner = this.ownerOf(a.id);
        if (owner) {
          const inIr = owner.lineup.IR === a.id;
          const body = next === "active"
            ? `${a.name} has been cleared and is Active.${inIr ? " Move them out of the IR spot before adding players." : ""}`
            : next === "Q" ? `${a.name} has been listed as Questionable.${inIr ? " Move them out of the IR spot before adding players." : ""}`
            : next === "O" ? `${a.name} has been listed as Out. You can move them to your IR spot.`
            : `${a.name} has been placed on IR. You can move them to your IR spot to free a roster spot.`;
          this.notify(`${a.name}: ${STATUS_LABEL[next]}`, body, "player", [owner.id], true, { key: `status:${a.id}:${Date.now()}`, link: { type: "player", id: a.id } });
        }
        return;
      }

      case "markRead": {
        const r = (s.reads[user.id] ??= { at: 0, ids: [] });
        if (action.all === true) {
          r.at = Date.now();
          r.ids = [];
        } else {
          const ids = strs("ids").filter((id) => s.notifications.some((n) => n.id === id));
          r.ids = [...new Set([...r.ids, ...ids])].slice(-200);
        }
        return;
      }

      case "addDrop": {
        inSeason();
        const team = this.myTeam(user);
        const addId = str("addId");
        const dropId = str("dropId") || null;
        const add = this.athlete(addId);
        this.assertNotLocked([addId, dropId]);
        this.assertIrClear(team, dropId);
        if (this.ownerOf(addId)) throw new ActionError(`${add.name} is already on a roster.`);
        if (s.waivers[addId]) throw new ActionError(`${add.name} is on waivers. Place a claim instead.`);
        if (this.addLimitReached(team)) throw new ActionError(`You've hit the ${this.st().maxAddsPerWeek}-add limit this week.`);
        const roster = this.rosterOf(team);
        if (dropId && !roster.includes(dropId)) throw new ActionError("You can only drop your own athletes.");
        const next = roster.filter((id) => id !== dropId).concat(addId);
        if (!dropId && roster.length >= SLOT_IDS.length) throw new ActionError("Roster full — pick someone to drop.");
        this.setRoster(team, next, `Can't add ${add.name}`);
        team.addsThisWeek++;
        let text = `${team.teamName} added ${add.name}`;
        if (dropId) {
          this.putOnWaivers(dropId);
          this.failTradesInvolving([dropId]);
          text += `, dropped ${this.nameOf(dropId)}`;
        }
        this.tx("add", team.id, text, [addId, ...(dropId ? [dropId] : [])]);
        for (const c of s.claims) {
          if (c.status === "pending" && c.teamId === team.id && c.addId === addId) { c.status = "cancelled"; c.reason = "Added directly"; c.resolvedAt = Date.now(); }
        }
        this.notify("Player added", `${add.name} joined your roster${dropId ? `; ${this.nameOf(dropId)} was dropped` : ""}.`, "waiver", [team.id], true, { key: `add:${team.id}:${addId}:${Date.now()}`, link: { type: "player", id: addId } });
        return;
      }

      case "drop": {
        inSeason();
        const team = this.myTeam(user);
        const dropId = str("athleteId");
        this.assertNotLocked([dropId]);
        const roster = this.rosterOf(team);
        if (!roster.includes(dropId)) throw new ActionError("That athlete isn't on your roster.");
        this.setRoster(team, roster.filter((id) => id !== dropId), "Drop");
        this.putOnWaivers(dropId);
        this.failTradesInvolving([dropId]);
        this.tx("drop", team.id, `${team.teamName} dropped ${this.nameOf(dropId)}`, [dropId]);
        this.notify("Player dropped", `${this.nameOf(dropId)} was dropped and is on waivers.`, "waiver", [team.id], false, { key: `drop:${team.id}:${dropId}:${Date.now()}`, link: { type: "player", id: dropId } });
        return;
      }

      case "claim": {
        inSeason();
        const team = this.myTeam(user);
        const addId = str("addId");
        const dropId = str("dropId") || null;
        const add = this.athlete(addId);
        if (!s.waivers[addId]) throw new ActionError(`${add.name} isn't on waivers — add them directly.`);
        if (this.ownerOf(addId)) throw new ActionError(`${add.name} is already on a roster.`);
        this.assertIrClear(team, dropId);
        const roster = this.rosterOf(team);
        if (dropId && !roster.includes(dropId)) throw new ActionError("You can only drop your own athletes.");
        if (!this.canHold(team, roster.filter((id) => id !== dropId).concat(addId))) throw new ActionError(dropId ? `There's no roster spot that fits ${add.name} after that drop.` : "Roster full — pick someone to drop.");
        const bid = this.st().waiverType === "faab" ? clampInt(action.bid, 0, team.faab, 0) : 0;
        // Same claim sent twice (double tap / retry): applied once.
        if (s.claims.some((c) => c.status === "pending" && c.teamId === team.id && c.addId === addId && c.dropId === dropId && c.bid === bid)) {
          throw new ActionError(`You already have this claim for ${add.name} pending.`);
        }
        for (const c of s.claims) {
          if (c.status === "pending" && c.teamId === team.id && c.addId === addId) {
            c.status = "cancelled";
            c.reason = "Replaced";
            c.resolvedAt = Date.now();
          }
        }
        const claimId = uid();
        const myPending = s.claims.filter((c) => c.status === "pending" && c.teamId === team.id);
        if (myPending.length >= 20) throw new ActionError("You can have up to 20 pending claims.");
        const nextRank = Math.max(0, ...myPending.map((c) => c.rank ?? 0)) + 1;
        s.claims.push({ id: claimId, teamId: team.id, addId, dropId, bid, createdAt: Date.now(), status: "pending", resolvedAt: null, reason: "", rank: nextRank });
        this.notify("Waiver claim submitted", `Claim for ${add.name}${dropId ? ` (dropping ${this.nameOf(dropId)})` : ""}${this.st().waiverType === "faab" ? ` · $${bid}` : ""}. Processes ${new Date((s.waivers[addId] ?? Date.now()) + this.st().tzOffsetMin * 60_000).toISOString().slice(5, 16).replace("T", " at ")}.`, "waiver", [team.id], false, { key: `claim:${claimId}`, link: { type: "transactions" } });
        return;
      }

      case "cancelClaim": {
        const mine = this.myTeam(user).id;
        const c = s.claims.find((x) => x.id === str("claimId") && x.teamId === mine && x.status === "pending");
        if (!c) throw new ActionError("That claim isn't pending.");
        c.status = "cancelled";
        c.reason = "Cancelled";
        c.resolvedAt = Date.now();
        return;
      }

      case "proposeTrade": {
        inSeason();
        if (this.tradeDeadlinePassed()) throw new ActionError("The trade deadline has passed.");
        const me = this.myTeam(user);
        const them = this.team(str("toId"));
        if (me.id === them.id) throw new ActionError("You can't trade with yourself.");
        const give = [...new Set(strs("give"))];
        const get = [...new Set(strs("get"))];
        if (give.length === 0 || get.length === 0) throw new ActionError("Pick at least one athlete on each side.");
        const counterOf = str("counterOf") || null;
        const trade: Trade = {
          id: uid(), fromId: me.id, toId: them.id, give, get,
          message: str("message").slice(0, 200), status: "pending",
          createdAt: Date.now(), resolvedAt: null, reviewUntil: null, vetoes: [], counterOf,
        };
        this.validateTrade(trade);
        if (counterOf) {
          const orig = s.trades.find((t) => t.id === counterOf && t.status === "pending" && t.toId === me.id);
          if (orig) {
            orig.status = "countered";
            orig.resolvedAt = Date.now();
          }
        }
        s.trades.push(trade);
        this.notify(counterOf ? `Counteroffer from ${me.teamName}` : `Trade offer from ${me.teamName}`, `They offer ${this.names(give)} for ${this.names(get)}.`, "trade", [them.id], true, { key: `trade:${trade.id}:offer` });
        return;
      }

      case "respondTrade": {
        const trade = s.trades.find((t) => t.id === str("tradeId"));
        if (!trade || trade.status !== "pending") throw new ActionError("That trade is no longer pending.");
        if (!this.canManageTeam(user.id, trade.toId)) throw new ActionError("Only the receiving team can respond.");
        const to = this.team(trade.toId);
        if (action.accept !== true) {
          trade.status = "declined";
          trade.resolvedAt = Date.now();
          this.notify("Trade declined", `${to.teamName} declined your offer (${this.names(trade.give)} for ${this.names(trade.get)}).`, "trade", [trade.fromId], true, { key: `trade:${trade.id}:declined` });
          return;
        }
        if (this.tradeDeadlinePassed()) throw new ActionError("The trade deadline has passed.");
        this.validateTrade(trade);
        if (this.st().tradeReview === "none") {
          this.completeTrade(trade);
          return;
        }
        trade.status = "review";
        trade.reviewUntil = Date.now() + Math.max(1, this.st().tradeReviewDays) * DAY;
        this.notify("Trade accepted — under review", `${to.teamName} accepted. It processes after the review period.`, "trade", [trade.fromId, trade.toId], true, { key: `trade:${trade.id}:accepted` });
        const reviewers = this.st().tradeReview === "commish" ? [s.commissionerId] : this.allIds().filter((id) => id !== trade.fromId && id !== trade.toId);
        this.notify(this.st().tradeReview === "commish" ? "Trade needs your review" : "Trade up for league vote", `${this.team(trade.fromId).teamName} ↔ ${to.teamName}: ${this.names(trade.give)} for ${this.names(trade.get)}`, "trade", reviewers);
        return;
      }

      case "cancelTrade": {
        const trade = s.trades.find((t) => t.id === str("tradeId"));
        if (!trade || trade.status !== "pending") throw new ActionError("That trade is no longer pending.");
        if (!this.canManageTeam(user.id, trade.fromId)) throw new ActionError("Only the proposer can cancel.");
        trade.status = "cancelled";
        trade.resolvedAt = Date.now();
        this.notify("Trade cancelled", `${this.team(trade.fromId).teamName} withdrew their offer.`, "trade", [trade.toId], true, { key: `trade:${trade.id}:cancelled` });
        return;
      }

      case "reviewTrade": {
        const trade = s.trades.find((t) => t.id === str("tradeId"));
        if (!trade || trade.status !== "review") throw new ActionError("That trade isn't under review.");
        const approve = action.approve === true;
        if (user.id === s.commissionerId && (this.st().tradeReview === "commish" || action.override === true)) {
          if (approve) this.assertNotLocked([...trade.give, ...trade.get]);
          if (approve) this.completeTrade(trade);
          else {
            trade.status = "vetoed";
            trade.resolvedAt = Date.now();
            this.tx("trade", trade.fromId, `Commissioner vetoed ${this.team(trade.fromId).teamName} ↔ ${this.team(trade.toId).teamName}`, [...trade.give, ...trade.get], { otherId: trade.toId, status: "vetoed" });
            this.notify("Trade vetoed", "The commissioner vetoed your trade.", "trade", [trade.fromId, trade.toId], true, { key: `trade:${trade.id}:vetoed` });
          }
          return;
        }
        if (this.st().tradeReview !== "league") throw new ActionError("Only the commissioner reviews trades in this league.");
        const voter = this.myTeam(user).id;
        if (voter === trade.fromId || voter === trade.toId) throw new ActionError("You can't vote on your own trade.");
        if (approve) {
          trade.vetoes = trade.vetoes.filter((x) => x !== voter);
          return;
        }
        if (!trade.vetoes.includes(voter)) trade.vetoes.push(voter);
        if (trade.vetoes.length >= this.st().vetoVotes) {
          trade.status = "vetoed";
          trade.resolvedAt = Date.now();
          this.tx("trade", trade.fromId, `League vetoed ${this.team(trade.fromId).teamName} ↔ ${this.team(trade.toId).teamName}`, [...trade.give, ...trade.get], { otherId: trade.toId, status: "vetoed" });
          this.notify("Trade vetoed", "The league voted down your trade.", "trade", [trade.fromId, trade.toId], true, { key: `trade:${trade.id}:vetoed` });
        }
        return;
      }

      case "runWaivers": {
        this.assertCommish(user);
        inSeason();
        const due = Object.keys(s.waivers).length;
        if (due === 0) throw new ActionError("No players are on waivers right now.");
        this.processWaivers(Number.MAX_SAFE_INTEGER);
        this.audit(user, "waivers.run", `Processed waivers early (${due} player${due === 1 ? "" : "s"})`);
        this.tx("commish", null, "The commissioner processed waivers");
        return;
      }

      case "lockLineups": {
        this.assertCommish(user);
        inSeason();
        this.lockWeek(s.week);
        this.tx("commish", null, `Week ${s.week} lineups locked`);
        return;
      }

      case "enterResult": {
        this.assertCommish(user);
        this.audit(user, "result.enter", `${str("event")} @ ${str("meet")}: ${this.names(strs("athleteIds"))} ${str("status") || ""} ${str("place")} ${str("mark")}`.trim());
        if (s.phase === "predraft" || s.phase === "drafting") throw new ActionError("Results can be entered once the season starts.");
        const r = this.buildResult(action);
        for (const old of [...this.results.values()]) {
          if (old.id !== r.id && old.key === r.key) {
            this.results.delete(old.id);
            await this.ctx.storage.delete(`res:${old.id}`);
          }
        }
        const replaced = this.results.has(r.id);
        this.results.set(r.id, r);
        await this.ctx.storage.put(`res:${r.id}`, r);
        await this.afterScoringChange(r.week, `${replaced ? "Corrected" : "Result"}: ${this.names(r.athleteIds)} · ${r.event} @ ${r.meet}${r.status !== "OK" ? ` (${r.status})` : r.place ? ` · ${r.place}` : ""}`, [r]);
        return;
      }

      case "deleteResult": {
        this.assertCommish(user);
        const r = this.results.get(str("resultId"));
        if (!r) throw new ActionError("Result not found.");
        if (r.source === "live" && !r.locked) throw new ActionError("This result comes from the live source. Correct it instead — deleting would be re-added on the next sync.");
        this.audit(user, "result.delete", `${this.names(r.athleteIds)} · ${r.event} @ ${r.meet}`);
        this.results.delete(r.id);
        await this.ctx.storage.delete(`res:${r.id}`);
        await this.afterScoringChange(r.week, `Removed result: ${this.names(r.athleteIds)} · ${r.event} @ ${r.meet}`);
        return;
      }

      case "setStandard": {
        this.assertCommish(user);
        const info = eventInfo(str("event"));
        if (!str("event")) throw new ActionError("Pick an event.");
        const gender: Gender = str("gender") === "G" ? "G" : "B";
        const season = clampInt(action.season, 2000, 2100, s.season);
        const same = (x: Standard): boolean => x.gender === gender && keyOf(x.event) === keyOf(info.name) && x.season === season;
        this.scoring.standards = this.scoring.standards.filter((x) => !same(x));
        const cols: [StandardType, string][] = [["NB", "nb"], ["NIKE", "nike"], ["STATES", "states"]];
        for (const [type, k] of cols) {
          const mark = str(k).slice(0, 16);
          if (!mark) continue;
          const custom = action[`${k}Points`];
          this.scoring.standards.push({
            id: `${gender}-${keyOf(info.name)}-${type}-${season}`, season, gender, event: info.name, type, mark,
            points: custom !== undefined ? clampInt(custom, 0, 20, STANDARD_DEFAULT_POINTS[type]) : STANDARD_DEFAULT_POINTS[type],
            active: action[`${k}Active`] !== false,
          });
        }
        await this.saveScoring();
        this.mirrorStandards();
        this.audit(user, "standard", `${gender === "G" ? "Girls" : "Boys"} ${info.name} ${season}: NB ${str("nb") || "—"}, Nike ${str("nike") || "—"}, States ${str("states") || "—"}`);
        await this.afterScoringChange(s.week, `Standards updated: ${gender === "G" ? "Girls" : "Boys"} ${info.name}`);
        return;
      }

      case "setPerformanceTable": {
        this.assertCommish(user);
        const label = this.setPerformanceTable(user, action);
        await this.saveScoring();
        await this.afterScoringChange(s.week, `Performance table updated: ${label}`);
        return;
      }

      case "toggleStandard": {
        this.assertCommish(user);
        const st = this.scoring.standards.find((x) => x.id === str("id"));
        if (!st) throw new ActionError("Standard not found.");
        st.active = action.active === true;
        await this.saveScoring();
        this.mirrorStandards();
        this.audit(user, "standard", `${st.active ? "Activated" : "Deactivated"} ${st.type} ${st.gender === "G" ? "Girls" : "Boys"} ${st.event}`);
        await this.afterScoringChange(s.week, `Standard ${st.active ? "activated" : "deactivated"}: ${st.event}`);
        return;
      }

      case "setMarkOnFile": {
        this.assertCommish(user);
        const a = this.athlete(str("athleteId"));
        const info = eventInfo(str("event"));
        const mark = str("mark").slice(0, 16);
        const marks = this.scoring.pbs[a.id] ?? {};
        if (mark) marks[info.name] = mark;
        else delete marks[info.name];
        this.scoring.pbs[a.id] = marks;
        await this.saveScoring();
        await this.afterScoringChange(s.week, `Mark on file updated for ${a.name} (${info.name})`);
        return;
      }

      case "addSchoolRecord": {
        this.assertCommish(user);
        const a = this.athlete(str("athleteId"));
        const info = eventInfo(str("event"));
        const date = str("date");
        if (!info.name) throw new ActionError("Pick an event.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError("Enter the date.");
        const season = clampInt(action.season, 2000, 2100, s.season);
        const dup = this.scoring.records.find((r) => r.athleteId === a.id && keyOf(r.event) === keyOf(info.name) && r.season === season);
        if (dup) throw new ActionError(`${a.name} already has a school record bonus in ${info.name} for ${season}.`);
        this.scoring.records.push({
          id: uid(), athleteId: a.id, school: str("school").slice(0, 60), event: info.name, date, mark: str("mark").slice(0, 16),
          season, week: clampInt(action.week, 1, Math.max(1, s.week), s.week), at: Date.now(),
        });
        await this.saveScoring();
        const srPts = (this.scoringInput([]).rulesFor?.(clampInt(action.week, 1, Math.max(1, s.week), s.week)) ?? DEFAULT_SCORING).schoolRecord;
        await this.afterScoringChange(s.week, `School record: ${a.name} · ${info.name} (${srPts >= 0 ? "+" : "−"}${String(Math.round(Math.abs(srPts) * 100) / 100)})`);
        return;
      }

      case "deleteSchoolRecord": {
        this.assertCommish(user);
        this.scoring.records = this.scoring.records.filter((r) => r.id !== str("id"));
        await this.saveScoring();
        await this.afterScoringChange(s.week, "School record removed");
        return;
      }

      case "addFumble": {
        this.assertCommish(user);
        const a = this.athlete(str("athleteId"));
        const date = str("date");
        if (!str("meet")) throw new ActionError("Enter the meet.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError("Enter the date.");
        this.scoring.fumbles.push({
          id: uid(), athleteId: a.id, teamId: str("teamId") || this.ownerOf(a.id)?.id || null,
          meet: str("meet").slice(0, 60), event: eventInfo(str("event") || "4x100 Relay").name, date,
          week: clampInt(action.week, 1, Math.max(1, s.week), s.week), at: Date.now(),
        });
        await this.saveScoring();
        const fPts = (this.scoringInput([]).rulesFor?.(clampInt(action.week, 1, Math.max(1, s.week), s.week)) ?? DEFAULT_SCORING).fumble;
        await this.afterScoringChange(s.week, `Baton fumble: ${a.name} (${fPts >= 0 ? "+" : "−"}${String(Math.round(Math.abs(fPts) * 100) / 100)})`);
        return;
      }

      case "deleteFumble": {
        this.assertCommish(user);
        this.scoring.fumbles = this.scoring.fumbles.filter((f) => f.id !== str("id"));
        await this.saveScoring();
        await this.afterScoringChange(s.week, "Baton fumble removed");
        return;
      }

      case "finalizeWeek": {
        this.assertCommish(user);
        inSeason();
        // The week ends with its meet. Weeks without a meet can be closed by the commissioner.
        const open = this.openMeets(s.week);
        if (open.length > 0) throw new ActionError(`${open.map((m) => m.name).join(", ")} isn't final yet. Mark the meet final — the week closes automatically when it is.`);
        this.finishWeek();
        return;
      }

      case "startNextWeek": {
        // Commissioner override: show the next matchup now instead of waiting for Monday.
        this.assertCommish(user);
        inSeason();
        if (s.advanceAt == null) throw new ActionError("The current week isn't final yet.");
        this.audit(user, "week.advance", `Week ${s.week + 1} activated early (scheduled for ${new Date(s.advanceAt).toISOString()})`);
        this.advanceWeek();
        return;
      }

      case "regenerateSchedule": {
        this.assertCommish(user);
        inSeason();
        if (action.confirm !== true) throw new ActionError("Confirm to replace the open weeks' matchups.");
        const from = this.firstEditableWeek();
        const weeks = this.st().regularWeeks;
        if (from > weeks) throw new ActionError("Every regular-season week has started. The schedule can't change now.");
        const seed = clampInt(String(action.seed ?? ""), 1, 1_000_000_000, 1);
        const ids = s.teams.map((t) => t.id);
        const next = regenerate(s.schedule as Game[], ids, weeks, from, seed);
        const check = checkSchedule(next, ids, weeks);
        const structural = check.checks.slice(0, 3).every((c) => c.ok);
        if (!structural) throw new ActionError(`Schedule check failed: ${check.problems.slice(0, 3).join(" ")}`);
        const keep = s.schedule.filter((m) => m.kind !== "regular" || m.week < from);
        const fresh = next.filter((g) => g.kind === "regular" && g.week >= from).map((g) => ({ ...g, final: false }));
        s.schedule = [...keep, ...fresh].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id)) as typeof s.schedule;
        this.logSchedule(user, "regenerate", `Weeks ${from}–${weeks} regenerated (seed ${seed}); weeks before ${from} unchanged`, from);
        return;
      }

      case "setWeekSchedule": {
        this.assertCommish(user);
        inSeason();
        if (action.confirm !== true) throw new ActionError("Confirm to change this week's matchups.");
        const week = clampInt(String(action.week ?? ""), 1, 60, 0);
        const from = this.firstEditableWeek();
        if (week < from) throw new ActionError(`Week ${week} has started or finished. Its matchups can't change.`);
        if (week > this.st().regularWeeks) throw new ActionError("Playoff matchups come from the bracket.");
        const pairs = Array.isArray(action.pairs) ? (action.pairs as unknown[]).map((p) => (Array.isArray(p) ? p.map((x) => (x ? String(x) : null)) : [])) : [];
        const ids = s.teams.map((t) => t.id);
        const seen = new Map<string, number>();
        for (const p of pairs) for (const t of p.slice(0, 2)) if (t) seen.set(t, (seen.get(t) ?? 0) + 1);
        const bad = ids.filter((t) => seen.get(t) !== 1);
        if (pairs.some((p) => !p[0] || p[0] === p[1]) || bad.length > 0 || [...seen.keys()].some((t) => !ids.includes(t))) {
          throw new ActionError("Every team must appear exactly once (one team may have a bye when the count is odd).");
        }
        if (pairs.filter((p) => !p[1]).length > (ids.length % 2)) throw new ActionError("Only one bye is allowed, and only with an odd number of teams.");
        const games = pairs.map((p) => ({ id: `${week}-${p[0]}`, week, homeId: p[0] as string, awayId: p[1] ?? null, final: false, kind: "regular" as const, round: null }));
        s.schedule = [...s.schedule.filter((m) => !(m.kind === "regular" && m.week === week)), ...games].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id)) as typeof s.schedule;
        this.logSchedule(user, "edit", `Week ${week}: ${games.map((g) => `${this.team(g.homeId).teamName} vs ${g.awayId ? this.team(g.awayId).teamName : "BYE"}`).join("; ")}`, week);
        return;
      }

      case "addAthlete": {
        this.assertCommish(user);
        const name = str("name").slice(0, 40);
        if (!name) throw new ActionError("Enter a name.");
        const id = normalizeName(name);
        if (!id) throw new ActionError("Enter a valid name.");
        if (s.athletes.some((a) => a.id === id)) throw new ActionError(`${name} is already in the pool.`);
        const { positions, flex } = this.parsePos(str("position") || str("pos"), strs("positions"));
        s.athletes.push({ id, name, gender: str("gender") === "G" ? "G" : "B", positions, flex, note: "", rank: s.athletes.length, school: str("school").slice(0, 60) });
        s.adp = resolveAdp(s.adpNames, s.athletes, s.adp);
        this.tx("commish", null, `${name} added to the athlete pool`, [id]);
        return;
      }

      case "editAthlete": {
        this.assertCommish(user);
        const a = this.athlete(str("athleteId"));
        // Validate everything first, then apply in one step, so a rejected edit never leaves a half-applied change in memory.
        const newName = str("name").slice(0, 40);
        const nextSchool = action.school !== undefined ? str("school").slice(0, 60) : a.school;
        const nextGender: Gender = action.gender !== undefined ? (str("gender") === "G" ? "G" : "B") : a.gender;
        const posGiven = action.position !== undefined || action.pos !== undefined || action.positions !== undefined;
        const prevCode = posCode(a);
        // Stale-write protection: the phone sends the position it last saw; if someone changed it since, refuse.
        if (posGiven && action.expectPosition !== undefined && str("expectPosition") !== prevCode) {
          throw new ActionError(`${a.name}'s position was just changed to ${POSITION_CODES[prevCode]?.label ?? prevCode}. Showing the latest.`);
        }
        const nextPos = posGiven ? this.parsePos(str("position") || str("pos"), strs("positions")) : { positions: a.positions, flex: a.flex };
        const nextCode = posCode(nextPos);
        const owner = this.ownerOf(a.id);
        let nextLineup: Record<SlotId, string | null> | null = null;
        if (owner && nextCode !== prevCode) {
          const prev = { positions: a.positions, flex: a.flex };
          a.positions = nextPos.positions;
          a.flex = nextPos.flex;
          nextLineup = this.solve(this.rosterOf(owner), owner.lineup);
          a.positions = prev.positions;
          a.flex = prev.flex;
          if (!nextLineup) throw new ActionError(`That change leaves ${owner.teamName} without a legal roster.`);
        }
        const changes: string[] = [];
        if (newName && newName !== a.name) changes.push(`name ${a.name} → ${newName}`);
        if ((nextSchool ?? "") !== (a.school ?? "")) changes.push(`school ${a.school || "—"} → ${nextSchool || "—"}`);
        if (nextGender !== a.gender) changes.push(`gender ${a.gender} → ${nextGender}`);
        if (nextCode !== prevCode) changes.push(`position ${POSITION_CODES[prevCode]?.label ?? prevCode} → ${POSITION_CODES[nextCode]?.label ?? nextCode}`);
        if (changes.length === 0) return;
        if (newName) a.name = newName;
        a.school = nextSchool;
        a.gender = nextGender;
        a.positions = nextPos.positions;
        a.flex = nextPos.flex;
        // Only the current lineup can move; locked/past weeks live in lineupSnapshots and scoring lines are never touched.
        if (owner && nextLineup) owner.lineup = nextLineup;
        this.audit(user, "athlete.edit", `${a.name}: ${changes.join("; ")}`);
        this.tx("commish", null, nextCode !== prevCode ? `${a.name} is now ${POSITION_CODES[nextCode]?.label ?? nextCode}` : `Commissioner edited ${a.name}`, [a.id]);
        if (owner && nextCode !== prevCode) {
          this.notify(`${a.name}: new position`, `${a.name} is now listed as ${POSITION_CODES[nextCode]?.label ?? nextCode}. Check your lineup.`, "player", [owner.id], true, { key: `pos:${a.id}:${Date.now()}`, link: { type: "player", id: a.id } });
        }
        return;
      }

      case "removeAthlete": {
        this.assertCommish(user);
        const a = this.athlete(str("athleteId"));
        const owner = this.ownerOf(a.id);
        if (owner) this.setRoster(owner, this.rosterOf(owner).filter((id) => id !== a.id), "Remove");
        this.failTradesInvolving([a.id]);
        s.athletes = s.athletes.filter((x) => x.id !== a.id);
        if (a.photoAt) await this.ctx.storage.delete(`aphoto:${a.id}:${a.photoAt}`);
        delete s.waivers[a.id];
        for (const t of s.teams) t.queue = t.queue.filter((id) => id !== a.id);
        this.tx("commish", null, `${a.name} removed from the athlete pool`);
        return;
      }

      case "removeTeam": {
        this.assertCommish(user);
        if (s.phase !== "predraft") throw new ActionError("Teams can only be removed before the draft.");
        const id = str("teamId");
        if (id === s.commissionerId) throw new ActionError("Hand off commissioner first — you can't remove yourself.");
        const t = this.team(id);
        s.teams = s.teams.filter((x) => x.id !== id);
        s.draft.order = s.draft.order.filter((x) => x !== id);
        if (t.coManagerId) await this.dir("/unmember", { userId: t.coManagerId, leagueId: s.id });
        if (t.coInvite) await this.dir("/co-drop", { code: t.coInvite.code });
        this.tx("commish", null, `${t.teamName} was removed from the league`);
        return;
      }

      case "setCommissioner": {
        this.assertCommish(user);
        const t = this.team(str("teamId"));
        s.commissionerId = t.id;
        this.tx("commish", t.id, `${t.ownerName} (${t.teamName}) is now the commissioner`);
        this.notify("You're the commissioner", `${user.name} handed you commissioner tools for ${s.name}.`, "commish", [t.id], true, { key: `commish:${t.id}:${Date.now()}` });
        this.notify("New commissioner", `${t.ownerName} is now the commissioner.`, "commish", this.allIds().filter((id) => id !== t.id), false, { key: `commish-all:${t.id}:${Date.now()}` });
        return;
      }

      // MARK: Meet Center

      case "createMeet": {
        this.assertCommish(user);
        if (s.meets.length >= 60) throw new ActionError("Too many meets — delete an old one first.");
        const m = this.blankMeet();
        this.applyMeetFields(m, action);
        if (action.testMeet === true) { m.testMeet = true; m.scope = "local"; m.history = action.history === true; }
        if (m.provider === "ATHLETICLIVE" && m.sourceUrl && !m.resultsUrl && !m.sourceMeetId) await this.resolveMeet(m, user);
        if (m.testMeet && m.sourceUrl && !m.sourceMeetId && !m.resultsUrl) throw new ActionError(m.resolve?.message ?? "That meet link couldn't be verified.");
        s.meets.push(m);
        this.audit(user, "meet.create", `${m.name} (Week ${m.week}, ${m.provider})`);
        this.mirror("meets", [this.meetRow(m)]);
        return;
      }

      case "updateMeet": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        const before = `${m.name} W${m.week} ${m.provider} ${m.resultsUrl}`;
        const weekBefore = m.week;
        this.applyMeetFields(m, action);
        if (m.provider === "ATHLETICLIVE" && m.sourceUrl && !m.resolve && action.sourceUrl !== undefined && action.resultsUrl === undefined) await this.resolveMeet(m, user);
        if (!m.isDemo && m.week !== weekBefore) {
          for (const r of this.results.values()) {
            if (r.meetId !== m.id || r.locked) continue;
            r.week = m.week;
            await this.ctx.storage.put(`res:${r.id}`, r);
          }
          this.recompute();
        }
        if (typeof action.feedResults === "string" || typeof action.feedRoster === "string" || typeof action.feedEvents === "string") {
          const cur = (await this.ctx.storage.get<RawFeed>(`feed:${m.id}`)) ?? { events: "", roster: "", results: "" };
          const next: RawFeed = {
            events: typeof action.feedEvents === "string" ? action.feedEvents.slice(0, 500_000) : cur.events,
            roster: typeof action.feedRoster === "string" ? action.feedRoster.slice(0, 900_000) : cur.roster,
            results: typeof action.feedResults === "string" ? action.feedResults.slice(0, 900_000) : cur.results,
          };
          await this.ctx.storage.put(`feed:${m.id}`, next);
        }
        this.audit(user, "meet.update", `${before} → ${m.name} W${m.week} ${m.provider} ${m.resultsUrl}`);
        this.mirror("meets", [this.meetRow(m)]);
        return;
      }

      case "deleteMeet": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        if (m.polling) throw new ActionError("Stop live scoring first.");
        const removed = [...this.results.values()].filter((r) => r.meetId === m.id && !r.locked);
        if (removed.length > 0 && action.removeScores !== true) {
          throw new ActionError(`${m.name} has ${removed.length} scored results. Confirm removing its scores to delete it.`);
        }
        for (const r of removed) {
          this.results.delete(r.id);
          await this.ctx.storage.delete(`res:${r.id}`);
        }
        await this.ctx.storage.delete(`demo:${m.id}`);
        await this.ctx.storage.delete(`feed:${m.id}`);
        s.meets = s.meets.filter((x) => x.id !== m.id);
        s.unmatched = s.unmatched.filter((u) => u.meetId !== m.id || u.status !== "open");
        this.audit(user, "meet.delete", `${m.name} (${removed.length} results removed)`);
        if (removed.length > 0) await this.afterScoringChange(m.week, `${m.name} and its ${removed.length} results were removed`);
        this.ctx.waitUntil(this.db.remove("meets", [`${s.id}:${m.id}`]).catch(() => undefined));
        return;
      }

      case "startLive": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        if (m.provider === "ATHLETICLIVE" && !m.resultsUrl && !m.sourceMeetId && m.sourceUrl) await this.resolveMeet(m, user);
        if (m.provider === "ATHLETICLIVE" && !m.resultsUrl && !m.sourceMeetId) {
          throw new ActionError(m.resolve && !m.resolve.ok ? `${m.resolve.message}` : "Add the meet's AthleticLIVE link, then test the connection.");
        }
        if (!m.isDemo && s.phase !== "season" && s.phase !== "complete") throw new ActionError("Live scoring opens once the draft is done.");
        // The next week's meet is starting before Monday: activate that week now so scores land in the right matchup.
        if (!m.isDemo && !m.history && s.advanceAt != null && m.week === s.week + 1) this.advanceWeek();
        m.status = "LIVE";
        m.polling = true;
        m.startedAt = m.startedAt ?? Date.now();
        m.finalAt = null;
        m.failures = 0;
        m.nextSyncAt = Date.now();
        this.audit(user, "meet.live", `Started live scoring: ${m.name}`);
        await this.syncMeet(m.id);
        if (!m.isDemo && !m.history) this.notify(`${m.name} is LIVE`, "Live scoring is on. Your matchup updates automatically as results post.", "score", null, true, { key: `live:${m.id}:${m.startedAt}`, link: { type: "matchup", week: m.week } });
        return;
      }

      case "stopLive": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        m.polling = false;
        m.nextSyncAt = null;
        this.audit(user, "meet.stop", `Stopped live scoring: ${m.name}`);
        this.mirror("meets", [this.meetRow(m)]);
        return;
      }

      case "syncMeet": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        const r = await this.syncMeet(m.id);
        if (r.error) throw new ActionError(`LIVE SOURCE UNAVAILABLE — ${r.error} Existing scores were kept.`);
        return;
      }

      case "markFinal": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        await this.finalizeMeet(m, user);
        this.audit(user, "meet.final", `Marked final: ${m.name}`);
        return;
      }

      case "enableSandbox": {
        this.assertCommish(user);
        if (this.isMain()) throw new ForbiddenError("The Main League can't be a test league.");
        if (String(action.confirm ?? "") !== "TEST LEAGUE") throw new ActionError("Type TEST LEAGUE to confirm.");
        const real = s.meets.filter((m) => !m.archived && !m.isDemo && m.scope !== "global" && !m.testMeet && !m.history);
        if (real.length > 0) throw new ActionError("Only a throwaway league with rehearsal meets can become a test league.");
        s.qaSandbox = true;
        this.audit(user, "sandbox.enable", "Marked as a throwaway test league (sandbox Admin Panel)");
        return;
      }

      case "setTestMode": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        if (!m.testMeet) throw new ActionError("Only rehearsal meets can be replayed.");
        const raw = (action.mode && typeof action.mode === "object" ? action.mode : null) as Record<string, unknown> | null;
        m.testMode = raw ? {
          include: Array.isArray(raw.include) ? (raw.include as unknown[]).map(String).slice(0, 400) : undefined,
          partial: raw.partial === true,
          mutate: Array.isArray(raw.mutate) ? (raw.mutate as Record<string, unknown>[]).slice(0, 20).map((x) => ({ eventId: String(x.eventId ?? ""), athlete: String(x.athlete ?? ""), set: (x.set ?? {}) as Record<string, string> })) : undefined,
        } : null;
        this.audit(user, "meet.testMode", `${m.name}: ${JSON.stringify(m.testMode).slice(0, 300)}`);
        if (action.sync !== false && m.status !== "UPCOMING" || action.sync === true) {
          const r = await this.syncMeet(m.id, { final: m.status === "FINAL" });
          if (r.error) throw new ActionError(r.error);
        }
        return;
      }

      case "resetTestMeet": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        if (!m.testMeet) throw new ActionError("Only rehearsal meets can be reset.");
        await this.snapshot(`Before resetting rehearsal meet ${m.name}`);
        const ids = [...this.results.values()].filter((r) => r.meetId === m.id).map((r) => r.id);
        for (const id of ids) this.results.delete(id);
        for (let i = 0; i < ids.length; i += 100) await this.ctx.storage.delete(ids.slice(i, i + 100).map((id) => `res:${id}`));
        this.rowHashes.delete(m.id);
        // Back to "before the meet": no entries, no started/finished events, no stats.
        m.entries = {}; m.entryEvents = {}; m.eventsStarted = {}; m.completedEvents = []; m.stats = emptyStats();
        m.status = "UPCOMING"; m.polling = false; m.nextSyncAt = null; m.finalAt = null; m.feedHash = undefined; m.testMode = null;
        if (s.locks) delete s.locks[String(m.week)];
        this.recompute();
        this.audit(user, "meet.testReset", `${m.name}: ${ids.length} results cleared`);
        return;
      }

      case "snapshotNow": {
        this.assertCommish(user);
        await this.snapshot(str("reason") || `Manual snapshot by ${user.name}`);
        return;
      }

      case "restoreSnapshot": {
        this.assertCommish(user);
        await this.restoreSnapshot(user, Number(action.at));
        return;
      }

      case "reopenMeet": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        m.status = "UPCOMING";
        m.finalAt = null;
        this.audit(user, "meet.reopen", `Reopened ${m.name}`);
        this.mirror("meets", [this.meetRow(m)]);
        return;
      }

      // MARK: Unmatched review

      case "confirmMatch": {
        this.assertCommish(user);
        const u = s.unmatched.find((x) => x.id === str("unmatchedId") && x.status === "open");
        if (!u) throw new ActionError("That item was already resolved.");
        if (u.kind === "mark") throw new ActionError("Fix this mark from Results & Corrections, or dismiss it.");
        if (u.kind === "event") {
          const ev = str("event");
          if (ev !== "IGNORE" && !EVENT_NAMES.some((n) => keyOf(n) === keyOf(ev))) throw new ActionError("Pick an event.");
          s.eventMap[u.sourceName] = ev === "IGNORE" ? "IGNORE" : EVENT_NAMES.find((n) => keyOf(n) === keyOf(ev)) ?? ev;
          u.status = "resolved";
          u.resolvedAthleteId = null;
        } else if (u.kind === "relay") {
          const ids = [...new Set(strs("athleteIds"))].filter((id) => !!this.maybeAthlete(id)).slice(0, 6);
          if (ids.length === 0) throw new ActionError("Pick the fantasy athletes who ran on this relay.");
          for (const k of u.mapKeys) s.mappings[k] = { key: k, athleteId: ids[0] ?? null, athleteIds: ids, rejected: [], sourceName: u.sourceName, school: u.school, gender: u.gender, by: user.id, at: Date.now() };
          u.status = "resolved";
          u.resolvedAthleteId = ids.join(",");
        } else {
          const a = this.athlete(str("athleteId"));
          for (const k of u.mapKeys) {
            const prev = s.mappings[k];
            s.mappings[k] = { key: k, athleteId: a.id, rejected: prev?.rejected ?? [], sourceName: u.sourceName, school: u.school, gender: u.gender, by: user.id, at: Date.now() };
          }
          if (u.sourceId && this.isMain()) {
            await this.dir("/source-links", { resolve: { sourceId: u.sourceId, athleteId: a.id, by: user.name } });
            this.linksAt = 0;
          }
          // Main League: "Ben Huang = Benjamin Huang" is saved as a permanent alias so every future meet matches it.
          if (this.isMain() && action.saveAlias !== false && u.kind === "athlete" && identityKey(u.sourceName) !== identityKey(a.name)) {
            await this.dir("/aliases", { alias: identityKey(u.sourceName), name: u.sourceName, athleteId: a.id, gender: a.gender, by: user.name });
            this.linksAt = 0;
            this.audit(user, "alias.confirm", `${u.sourceName} = ${a.name} (saved permanently)`);
          }
          u.status = "resolved";
          u.resolvedAthleteId = a.id;
          this.mirror("athlete_mappings", u.mapKeys.map((k) => ({
            id: `${s.id}:${hash(k)}`, league_id: s.id, provider: this.meet(u.meetId).provider, source_key: k, athlete_id: a.id, rejected: false,
            source_name: u.sourceName, school: u.school, gender: u.gender, confirmed_by: user.id,
          })));
        }
        u.resolvedAt = Date.now();
        u.resolvedBy = user.id;
        this.audit(user, "match.confirm", `${u.sourceName} (${u.school || u.kind}) → ${u.kind === "event" ? s.eventMap[u.sourceName] : u.kind === "relay" ? this.names((u.resolvedAthleteId ?? "").split(",")) : this.nameOf(u.resolvedAthleteId ?? "")}`);
        this.mirror("unmatched_results", [this.unmatchedRow(u)]);
        // Re-import the meet right away so the confirmed athlete's points, matchups and standings update now.
        const m = s.meets.find((x) => x.id === u.meetId);
        if (m && (m.status !== "UPCOMING" || m.lastSyncedAt !== null)) await this.syncMeet(m.id, { final: m.status === "FINAL" });
        // Finished weeks never change on their own; the commissioner can explicitly apply this confirmation to them.
        if (m && !m.history && action.applyToFinal === true) this.correctFinalWeek(m.week, user, `${u.sourceName} confirmed as ${this.nameOf(u.resolvedAthleteId ?? "")}`);
        return;
      }

      case "rejectMatch": {
        this.assertCommish(user);
        const u = s.unmatched.find((x) => x.id === str("unmatchedId") && x.status === "open");
        if (!u) throw new ActionError("That item was already resolved.");
        const reject = str("athleteId");
        if (u.kind === "athlete" && reject) {
          for (const k of u.mapKeys) {
            const prev = s.mappings[k];
            const rejected = [...new Set([...(prev?.rejected ?? []), reject])];
            s.mappings[k] = { key: k, athleteId: prev?.athleteId ?? null, rejected, sourceName: u.sourceName, school: u.school, gender: u.gender, by: user.id, at: Date.now() };
          }
          u.candidates = u.candidates.filter((c) => c !== reject);
        }
        if (!reject || u.candidates.length === 0) {
          u.status = "dismissed";
          u.resolvedAt = Date.now();
          u.resolvedBy = user.id;
          if (u.kind === "event") s.eventMap[u.sourceName] = "IGNORE";
        }
        this.audit(user, "match.reject", `${u.sourceName} (${u.school || u.kind}) is not ${reject ? this.nameOf(reject) : "a fantasy athlete"}`);
        this.mirror("unmatched_results", [this.unmatchedRow(u)]);
        return;
      }

      case "removeMapping": {
        this.assertCommish(user);
        const k = str("key");
        if (!s.mappings[k]) throw new ActionError("Mapping not found.");
        delete s.mappings[k];
        this.audit(user, "match.remove", `Removed mapping ${k}`);
        return;
      }

      // MARK: Live result corrections

      case "correctResult": {
        this.assertCommish(user);
        const r = this.results.get(str("resultId"));
        if (!r) throw new ActionError("Result not found.");
        const before = `${r.status} ${r.place ?? "–"} ${r.mark}`;
        const optInt = (k: string): number | null | undefined => {
          if (action[k] === undefined) return undefined;
          if (action[k] === null || action[k] === "") return null;
          const n = Number(action[k]);
          return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
        };
        const st = str("status").toUpperCase();
        if (st) r.status = st === "DQ" || st === "DNF" ? st : "OK";
        if (action.mark !== undefined) r.mark = str("mark").slice(0, 20);
        const p = optInt("place"); if (p !== undefined) r.place = p;
        const hp = optInt("heatPlace"); if (hp !== undefined) r.heatPlace = hp;
        const sd = optInt("seeded"); if (sd !== undefined) r.seeded = sd;
        if (action.best !== undefined) r.best = ["PB", "SB", "none"].includes(str("best")) ? (str("best") as BestOverride) : "auto";
        r.provisional = false;
        r.pctPlace = null;
        r.locked = true;
        r.detail = `${r.detail ? `${r.detail} · ` : ""}Corrected by commissioner`.replace(/( · Corrected by commissioner)+$/, " · Corrected by commissioner");
        await this.ctx.storage.put(`res:${r.id}`, r);
        for (const u of s.unmatched) {
          if (u.kind === "mark" && u.status === "open" && u.mapKeys.includes(r.id)) {
            u.status = "resolved";
            u.resolvedAt = Date.now();
            u.resolvedBy = user.id;
          }
        }
        this.audit(user, "result.correct", `${this.names(r.athleteIds)} · ${r.event} @ ${r.meet}: ${before} → ${r.status} ${r.place ?? "–"} ${r.mark}`);
        await this.afterScoringChange(r.week, `Correction: ${this.names(r.athleteIds)} · ${r.event} @ ${r.meet}`, [r]);
        return;
      }

      case "unlockResult": {
        this.assertCommish(user);
        const r = this.results.get(str("resultId"));
        if (!r) throw new ActionError("Result not found.");
        r.locked = false;
        await this.ctx.storage.put(`res:${r.id}`, r);
        this.audit(user, "result.unlock", `${this.names(r.athleteIds)} · ${r.event}: live source controls this result again`);
        const m = r.meetId ? s.meets.find((x) => x.id === r.meetId) : undefined;
        if (m) await this.syncMeet(m.id, { final: m.status === "FINAL" });
        return;
      }

      case "resolveMeet": {
        this.assertCommish(user);
        const m = this.meet(str("meetId"));
        if (action.sourceUrl !== undefined) this.applyMeetFields(m, { sourceUrl: action.sourceUrl });
        if (!m.sourceUrl) throw new ActionError("Paste the meet's AthleticLIVE link first.");
        await this.resolveMeet(m, user);
        return;
      }

      // MARK: Co-managers

      case "createCoInvite": {
        const team = this.myTeam(user);
        if (team.id !== user.id) throw new ActionError("Only the team's manager can invite a co-manager.");
        if (team.coManagerId) throw new ActionError(`${team.coManagerName ?? "Your co-manager"} already co-manages this team. Remove them first.`);
        if (team.coInvite) await this.dir("/co-drop", { code: team.coInvite.code });
        const r = await this.dir("/co-reserve", { leagueId: s.id, teamId: team.id });
        team.coInvite = { code: String(r.code ?? ""), at: Date.now() };
        this.audit(user, "comanager.invite", `${team.teamName}: invite created`);
        return;
      }

      case "cancelCoInvite": {
        const team = this.myTeam(user);
        if (team.id !== user.id) throw new ActionError("Only the team's manager can cancel the invite.");
        if (!team.coInvite) throw new ActionError("There's no open invite.");
        await this.dir("/co-drop", { code: team.coInvite.code });
        team.coInvite = null;
        return;
      }

      case "removeCoManager": {
        const team = this.myTeam(user);
        if (team.id !== user.id) throw new ActionError("Only the team's manager can remove the co-manager.");
        const coId = team.coManagerId;
        if (!coId) throw new ActionError("This team has no co-manager.");
        const name = team.coManagerName ?? "The co-manager";
        this.pendingPushes.push({ title: "Co-manager access removed", body: `${team.ownerName} removed you as co-manager of ${team.teamName}.`, category: "league", targets: [coId], data: { leagueId: s.id, kind: "league", category: "league", link: "none" } });
        team.coManagerId = null;
        team.coManagerName = null;
        await this.dir("/unmember", { userId: coId, leagueId: s.id });
        this.tx("league", team.id, `${name} is no longer co-managing ${team.teamName}`);
        this.audit(user, "comanager.remove", `${team.teamName}: removed ${name}`);
        return;
      }

      case "leaveCoManager": {
        const team = s.teams.find((t) => t.coManagerId === user.id);
        if (!team) throw new ActionError("You're not co-managing a team here.");
        team.coManagerId = null;
        team.coManagerName = null;
        await this.dir("/unmember", { userId: user.id, leagueId: s.id });
        this.tx("league", team.id, `${user.name} stopped co-managing ${team.teamName}`);
        this.notify("Co-manager left", `${user.name} is no longer co-managing ${team.teamName}.`, "league", [team.id], true, { key: `co-left:${team.id}:${user.id}:${Date.now()}` });
        return;
      }

      // MARK: ADP

      case "setAdp": {
        this.assertCommish(user);
        if (s.phase !== "predraft") throw new ActionError("Draft rankings are locked once the draft starts.");
        const names = strs("names").map((n) => n.trim()).filter(Boolean).slice(0, 200);
        s.adpNames = names;
        s.adp = resolveAdp(names, s.athletes, s.adp);
        this.audit(user, "adp.set", `${names.length} ranked athletes`);
        return;
      }

      case "resolveAdp": {
        this.assertCommish(user);
        const e = s.adp.find((x) => norm(x.name) === norm(str("name")));
        if (!e) throw new ActionError("Ranking not found.");
        const aid = str("athleteId");
        if (aid) {
          this.athlete(aid);
          if (s.adp.some((x) => x !== e && x.athleteId === aid)) throw new ActionError(`${this.nameOf(aid)} is already ranked.`);
          e.athleteId = aid;
          e.match = "manual";
        } else {
          e.athleteId = null;
          e.match = "skipped";
        }
        e.candidates = [];
        this.audit(user, "adp.resolve", `${e.name} → ${aid ? this.nameOf(aid) : "skipped"}`);
        return;
      }

      default:
        throw new ActionError("Unknown action.");
    }
  }

  // MARK: - Directory calls

  /** Calls the global Directory. Throws on failure so the caller's change is never half-applied. */
  private async dir(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await this.env.DO.fetch(new Request(`https://internal${path}`, { method: "POST", headers: DIR_HEADERS, body: JSON.stringify(body) }));
    const out = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new ActionError(String(out.error ?? "Something went wrong. Nothing was changed."));
    return out;
  }

  // MARK: - One-link meet setup

  /** Turns the pasted meet link into feed URLs and records the honest outcome on the meet. */
  private async resolveMeet(m: Meet, user: User): Promise<void> {
    const r = await checkSource(m.sourceUrl ?? "", { date: m.date || undefined, name: m.name });
    m.resolve = { ok: r.ok, kind: r.kind, message: r.message, at: Date.now() };
    if (r.kind === "athleticlive") {
      m.sourceMeetId = r.ok ? r.meetId : null;
      m.sourceInfo = r.ok && r.meta ? { name: r.meta.name, date: r.meta.date, location: r.meta.location, timer: r.meta.timer, url: m.sourceUrl ?? "" } : null;
    } else if (r.ok) {
      m.eventsUrl = r.eventsUrl;
      m.rosterUrl = r.rosterUrl;
      m.resultsUrl = r.resultsUrl;
    }
    this.audit(user, "meet.resolve", `${m.name || "Meet"}: ${r.ok ? "resolved" : "not resolved"} — ${r.message}`);
  }

  // MARK: - League deletion

  /**
   * Commissioner-only, type-the-name confirmed. The Directory drops the invite code and every membership first (in one
   * transaction); only if that succeeds is this league's storage wiped. Accounts, shared athlete data and other leagues
   * are never touched. Connected phones are told immediately and every later request gets 404.
   */
  private async deleteLeague(user: User, confirmName: string): Promise<unknown> {
    const s = this.require();
    if (s.commissionerId !== user.id) throw new ForbiddenError("Only the commissioner can delete this league.");
    if (confirmName.trim() !== s.name.trim()) throw new ActionError("Type the league name exactly to confirm.");
    const members = [...new Set(s.teams.flatMap((t) => [t.id, t.coManagerId ?? ""]).filter(Boolean))];
    const codes = s.teams.map((t) => t.coInvite?.code).filter((c): c is string => !!c);
    await this.dir("/drop-league", { leagueId: s.id, members, coCodes: codes });
    const leagueId = s.id;
    const meetIds = s.meets.map((m) => `${leagueId}:${m.id}`);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: "deleted" })); ws.close(4404, "league deleted"); } catch { /* gone */ }
    }
    await this.env.DO.deleteAlarm("League", leagueId).catch(() => undefined);
    await this.ctx.storage.deleteAll();
    this.state = null;
    this.results.clear();
    this.mocks.clear();
    this.projCache.clear();
    this.lines = [];
    this.pts = {};
    if (this.db.enabled) {
      this.ctx.waitUntil(Promise.all([
        this.db.replace("scoring_events", leagueId, []), this.db.replace("performance_history", leagueId, []),
        this.db.replace("scoring_standards", leagueId, []), this.db.remove("meets", meetIds),
      ]).catch((e: unknown) => console.warn("mirror cleanup after delete failed", String(e))));
    }
    return { ok: true, deleted: leagueId };
  }

  // MARK: - Co-manager invites

  private async coInviteRoute(op: string, user: User, teamId: string, code: string): Promise<unknown> {
    const s = this.require();
    const team = s.teams.find((t) => t.id === teamId);
    if (!team || !team.coInvite || team.coInvite.code !== code) throw new ActionError("That co-manager invite is no longer valid.");
    const info = { leagueId: s.id, leagueName: s.name, teamId: team.id, teamName: team.teamName, ownerName: team.ownerName, phase: s.phase };
    if (op === "co-preview") return info;
    if (op === "co-decline") {
      team.coInvite = null;
      this.notify("Co-manager invite declined", `${user.name} declined your invite to co-manage ${team.teamName}.`, "league", [team.id], true, { key: `co-decline:${team.id}:${code}` });
      await this.save();
      return { ok: true };
    }
    if (team.id === user.id) throw new ActionError("You already manage this team.");
    if (team.coManagerId) throw new ActionError(`${team.teamName} already has a co-manager.`);
    if (this.teamOf(user.id)) throw new ActionError("You already manage a team in this league. A co-manager can't also run their own team here.");
    team.coManagerId = user.id;
    team.coManagerName = user.name.slice(0, 32);
    team.coInvite = null;
    this.tx("league", team.id, `${team.coManagerName} is now co-managing ${team.teamName}`);
    this.notify("Co-manager joined", `${team.coManagerName} accepted and can now manage ${team.teamName} with you.`, "league", [team.id], true, { key: `co-join:${team.id}:${user.id}` });
    this.audit(user, "comanager.join", `${user.name} joined ${team.teamName} as co-manager`);
    await this.save();
    return { ...info, ok: true };
  }

  // MARK: - Mock drafts (isolated practice drafts)

  private async saveMock(mk: Mock): Promise<void> {
    mk.version += 1;
    mk.updatedAt = Date.now();
    this.mocks.set(mk.id, mk);
    await this.ctx.storage.put(`mock:${mk.id}`, mk);
    await this.scheduleAlarm();
    const msg = JSON.stringify({ type: "mock", mockId: mk.id, version: mk.version });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch { /* gone */ } }
  }

  private mockOnClock(mk: Mock): MockSeat | null {
    const count = mk.order.length;
    const n = mk.picks.length;
    if (mk.status !== "live" || count === 0 || n >= count * ROUNDS) return null;
    const round = Math.floor(n / count);
    const idx = n % count;
    const id = round % 2 === 0 ? mk.order[idx] : mk.order[count - 1 - idx];
    return mk.seats.find((x) => x.id === id) ?? null;
  }

  /** Best available fit for a mock seat: fills open SPR/DIS/FLD first, then the draft ranking. Bots vary among the top few. */
  private mockAutoPick(mk: Mock, seatId: string, bot: boolean): string | null {
    const taken = new Set(mk.picks.map((p) => p.athleteId));
    const lineup = mk.lineups[seatId] ?? emptyLineup();
    const roster = SLOT_IDS.map((x) => lineup[x]).filter((x): x is string => !!x);
    const fits = (id: string): boolean => this.solve([...roster, id], lineup, false, new Set()) !== null;
    const available = this.adpOrder().filter((id) => !taken.has(id)).map((id) => this.athlete(id));
    const open = (["SPR", "DIS", "FLD"] as SlotId[]).filter((slot) => !lineup[slot]);
    const need = available.filter((a) => open.some((slot) => this.eligible(a, slot)) && fits(a.id)).slice(0, 3);
    const any = available.filter((a) => fits(a.id)).slice(0, 3);
    const pool = need.length > 0 ? need : any;
    if (pool.length === 0) return null;
    if (!bot) return (pool[0] as Athlete).id;
    const h = parseInt(hash(`${mk.id}:${mk.picks.length}`).slice(0, 6), 36);
    const r = h % 10;
    return (pool[r < 6 ? 0 : r < 9 ? Math.min(1, pool.length - 1) : pool.length - 1] as Athlete).id;
  }

  private mockPick(mk: Mock, seatId: string, athleteId: string, auto: boolean): void {
    if (mk.picks.some((p) => p.athleteId === athleteId)) throw new ActionError(`${this.nameOf(athleteId)} was already picked.`);
    const lineup = mk.lineups[seatId] ?? emptyLineup();
    const roster = SLOT_IDS.map((x) => lineup[x]).filter((x): x is string => !!x);
    const next = this.solve([...roster, this.athlete(athleteId).id], lineup, false, new Set());
    if (!next) throw new ActionError(`${this.nameOf(athleteId)} doesn't fit an open spot on that roster.`);
    mk.lineups[seatId] = next;
    const count = mk.order.length;
    const n = mk.picks.length;
    mk.picks.push({ overall: n + 1, round: Math.floor(n / count) + 1, pickInRound: (n % count) + 1, seatId, athleteId, auto, at: Date.now() });
    if (mk.picks.length >= count * ROUNDS) { mk.status = "done"; mk.deadline = null; return; }
    mk.deadline = Date.now() + mk.pickSeconds * 1000;
  }

  /** Bots pick immediately until a person is on the clock. */
  private mockRunBots(mk: Mock): void {
    for (let guard = 0; guard < 200; guard++) {
      const seat = this.mockOnClock(mk);
      if (!seat || !seat.bot) return;
      const id = this.mockAutoPick(mk, seat.id, true);
      if (!id) { mk.status = "done"; mk.deadline = null; return; }
      this.mockPick(mk, seat.id, id, true);
    }
  }

  private async runMockClocks(now: number): Promise<void> {
    for (const mk of [...this.mocks.values()]) {
      if (mk.status !== "live" || mk.deadline === null || mk.deadline > now + 750) continue;
      const seat = this.mockOnClock(mk);
      if (!seat) continue;
      const id = this.mockAutoPick(mk, seat.id, seat.bot);
      if (!id) { mk.status = "done"; mk.deadline = null; }
      else { this.mockPick(mk, seat.id, id, true); this.mockRunBots(mk); }
      await this.saveMock(mk);
    }
  }

  private mockView(userId: string, mockId: string): unknown {
    const list = [...this.mocks.values()]
      .filter((mk) => mk.kind === "league" || mk.ownerId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((mk) => ({ id: mk.id, kind: mk.kind, ownerId: mk.ownerId, ownerName: mk.ownerName, status: mk.status, createdAt: mk.createdAt, seats: mk.seats.length, joined: mk.seats.filter((x) => !x.bot && x.userId).length, picks: mk.picks.length, mine: mk.seats.some((x) => x.userId === userId) }));
    const mk = mockId ? this.mocks.get(mockId) : undefined;
    if (mockId && (!mk || (mk.kind === "solo" && mk.ownerId !== userId))) throw new ActionError("That mock draft was deleted.");
    return { mocks: list, mock: mk ? { ...mk, rounds: ROUNDS, onClock: this.mockOnClock(mk)?.id ?? null, mySeat: mk.seats.find((x) => x.userId === userId)?.id ?? null } : null, serverNow: Date.now() };
  }

  private async mockOp(user: User, op: Record<string, unknown>): Promise<unknown> {
    const s = this.require();
    const type = String(op.op ?? "");
    const get = (): Mock => {
      const mk = this.mocks.get(String(op.mockId ?? ""));
      if (!mk || (mk.kind === "solo" && mk.ownerId !== user.id)) throw new ActionError("That mock draft was deleted.");
      return mk;
    };
    const ownerOnly = (mk: Mock): void => { if (mk.ownerId !== user.id) throw new ActionError("Only the person who created this mock can do that."); };
    const bot = (i: number): MockSeat => ({ id: `s${i}`, userId: null, name: `Bot ${i}`, bot: true });
    const shuffle = <T>(xs: T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j] as T, a[i] as T]; } return a; };
    /** Draft order: people who picked a position get it; every other seat is shuffled into the open positions. */
    const orderFor = (m: Mock): string[] => {
      const n = m.seats.length;
      const order: (string | null)[] = Array.from({ length: n }, () => null);
      for (const x of m.seats) {
        const p = x.bot ? null : x.slot ?? null;
        if (p !== null && p >= 1 && p <= n && order[p - 1] === null) order[p - 1] = x.id;
      }
      const rest = shuffle(m.seats.filter((x) => !order.includes(x.id)).map((x) => x.id));
      return order.map((id) => id ?? (rest.shift() as string));
    };
    /** Validates a requested draft position for this user's seat. 0/null = random. */
    const takeSlot = (m: Mock, seat: MockSeat, raw: unknown): void => {
      if (raw === undefined) return;
      const p = raw === null || raw === "" || Number(raw) === 0 ? null : clampInt(raw, 1, m.seats.length, 1);
      if (p !== null) {
        const other = m.seats.find((x) => x.id !== seat.id && !x.bot && x.slot === p);
        if (other) throw new ActionError(`${other.name} already picked position ${p}. Choose another.`);
      }
      seat.slot = p;
    };
    let mk: Mock;
    switch (type) {
      case "create": {
        const kind = op.kind === "league" ? "league" : "solo";
        if ([...this.mocks.values()].filter((x) => x.ownerId === user.id).length >= 5) throw new ActionError("You have 5 mock drafts. Delete one first.");
        const teams = clampInt(op.teams, 2, 14, Math.max(4, s.teams.length));
        if (teams * ROUNDS > s.athletes.length) throw new ActionError("Not enough athletes for that many teams.");
        const seats: MockSeat[] = Array.from({ length: teams }, (_, i) => bot(i + 1));
        seats[0] = { id: "s1", userId: user.id, name: user.name.slice(0, 24), bot: false, slot: null };
        const now = Date.now();
        mk = {
          id: uid(), kind, ownerId: user.id, ownerName: user.name.slice(0, 24), createdAt: now, updatedAt: now, status: kind === "solo" ? "live" : "lobby",
          seats, order: [], picks: [], lineups: {}, pickSeconds: clampInt(op.pickSeconds, 10, 300, kind === "solo" ? 45 : 60), deadline: null, version: 0,
        };
        takeSlot(mk, seats[0] as MockSeat, op.position);
        for (const x of seats) mk.lineups[x.id] = emptyLineup();
        if (kind === "solo") {
          mk.order = orderFor(mk);
          mk.deadline = now + mk.pickSeconds * 1000;
          this.mockRunBots(mk);
        }
        break;
      }
      case "join": {
        mk = get();
        if (mk.kind !== "league") throw new ActionError("Solo mocks can't be joined.");
        if (mk.status !== "lobby") throw new ActionError("This mock already started.");
        if (!mk.seats.some((x) => x.userId === user.id)) {
          const open = mk.seats.find((x) => x.bot);
          if (!open) throw new ActionError("This mock is full.");
          open.userId = user.id; open.name = user.name.slice(0, 24); open.bot = false; open.slot = null;
        }
        takeSlot(mk, mk.seats.find((x) => x.userId === user.id) as MockSeat, op.position);
        break;
      }
      case "setPosition": {
        mk = get();
        if (mk.status !== "lobby" && !(mk.kind === "solo" && mk.picks.length === 0)) throw new ActionError("Draft positions lock once the mock starts. Restart it to pick again.");
        const seat = mk.seats.find((x) => x.userId === user.id);
        if (!seat) throw new ActionError("Join this mock first.");
        takeSlot(mk, seat, op.position ?? null);
        if (mk.kind === "solo" && mk.status === "live") {
          mk.order = orderFor(mk);
          mk.deadline = Date.now() + mk.pickSeconds * 1000;
          this.mockRunBots(mk);
        }
        break;
      }
      case "leave": {
        mk = get();
        if (mk.ownerId === user.id) throw new ActionError("You created this mock. Delete it instead.");
        const seat = mk.seats.find((x) => x.userId === user.id);
        if (seat) { const n = mk.seats.indexOf(seat) + 1; Object.assign(seat, bot(n), { id: seat.id }); }
        break;
      }
      case "start": {
        mk = get();
        ownerOnly(mk);
        if (mk.status !== "lobby") throw new ActionError("This mock already started.");
        mk.order = orderFor(mk);
        mk.status = "live";
        mk.deadline = Date.now() + mk.pickSeconds * 1000;
        this.mockRunBots(mk);
        break;
      }
      case "pick": {
        mk = get();
        const seat = this.mockOnClock(mk);
        if (!seat) throw new ActionError("This mock isn't running.");
        if (seat.userId !== user.id) throw new ActionError("It's not your pick.");
        if (op.pickNumber !== undefined && Number(op.pickNumber) !== mk.picks.length + 1) throw new ActionError("That pick was already made. The board has been refreshed.");
        const athleteId = String(op.athleteId ?? "") || this.mockAutoPick(mk, seat.id, false);
        if (!athleteId) throw new ActionError("No athletes left.");
        this.mockPick(mk, seat.id, athleteId, false);
        this.mockRunBots(mk);
        break;
      }
      case "reset": {
        mk = get();
        ownerOnly(mk);
        mk.picks = [];
        for (const x of mk.seats) mk.lineups[x.id] = emptyLineup();
        if (op.position !== undefined) takeSlot(mk, mk.seats.find((x) => x.userId === user.id) as MockSeat, op.position);
        mk.order = orderFor(mk);
        mk.status = mk.kind === "solo" ? "live" : "lobby";
        mk.deadline = mk.status === "live" ? Date.now() + mk.pickSeconds * 1000 : null;
        if (mk.status === "live") this.mockRunBots(mk);
        break;
      }
      case "delete": {
        mk = get();
        ownerOnly(mk);
        this.mocks.delete(mk.id);
        await this.ctx.storage.delete(`mock:${mk.id}`);
        await this.scheduleAlarm();
        return this.mockView(user.id, "");
      }
      default:
        throw new ActionError("Unknown mock action.");
    }
    await this.saveMock(mk);
    return this.mockView(user.id, mk.id);
  }

  // MARK: - Integrity: snapshots, breakdowns, reconcile, health

  /** Recoverable copy of this league's results + scoring, taken before any score-changing operation. */
  private async snapshot(reason: string): Promise<number> {
    const at = Date.now();
    const results = [...this.results.values()];
    const per = 50;
    const chunks = Math.max(1, Math.ceil(results.length / per));
    for (let i = 0; i < chunks; i += 100) {
      const puts: Record<string, unknown> = {};
      for (let j = i; j < Math.min(chunks, i + 100); j++) puts[`snap:${at}:r${j}`] = results.slice(j * per, (j + 1) * per);
      await this.ctx.storage.put(puts);
    }
    await this.ctx.storage.put(`snap:${at}:scoring`, this.scoring);
    const index = (await this.ctx.storage.get<SnapMeta[]>("snaps")) ?? [];
    index.push({ at, reason: reason.slice(0, 200), results: results.length, chunks, points: round2(this.lines.reduce((t, l) => t + l.points, 0)), linesHash: this.linesHash });
    for (const old of index.slice(0, Math.max(0, index.length - 25))) {
      await this.ctx.storage.delete([...Array.from({ length: old.chunks }, (_, j) => `snap:${old.at}:r${j}`), `snap:${old.at}:scoring`].slice(0, 128));
    }
    await this.ctx.storage.put("snaps", index.slice(-25));
    return at;
  }

  private async restoreSnapshot(user: User, at: number): Promise<void> {
    const index = (await this.ctx.storage.get<SnapMeta[]>("snaps")) ?? [];
    const meta = index.find((x) => x.at === at);
    if (!meta) throw new ActionError("That snapshot wasn't found.");
    const keys = Array.from({ length: meta.chunks }, (_, j) => `snap:${at}:r${j}`);
    const got = new Map<string, Result[]>();
    for (let i = 0; i < keys.length; i += 100) for (const [k, v] of await this.ctx.storage.get<Result[]>(keys.slice(i, i + 100))) got.set(k, v);
    const results = keys.flatMap((k) => got.get(k) ?? []);
    if (results.length !== meta.results) throw new ActionError("That snapshot is incomplete. Nothing was changed.");
    await this.snapshot(`Before restoring the snapshot from ${iso(at)}`);
    const old = [...this.results.keys()];
    for (let i = 0; i < old.length; i += 100) await this.ctx.storage.delete(old.slice(i, i + 100).map((id) => `res:${id}`));
    this.results.clear();
    for (let i = 0; i < results.length; i += 100) {
      const puts: Record<string, Result> = {};
      for (const r of results.slice(i, i + 100)) { puts[`res:${r.id}`] = r; this.results.set(r.id, r); }
      await this.ctx.storage.put(puts);
    }
    const sc = await this.ctx.storage.get<Scoring>(`snap:${at}:scoring`);
    if (sc) { this.scoring = sc; await this.saveScoring(); }
    this.rowHashes.clear();
    this.recompute();
    this.audit(user, "snapshot.restore", `Restored ${results.length} results from the snapshot "${meta.reason}" (${iso(at)})`);
  }

  private lineView(l: Line): Record<string, unknown> {
    return { code: l.code, category: categoryOf(l), label: l.label, points: l.points, basis: l.basis ?? "", ver: l.ver ?? "", season: l.season ?? null };
  }

  /** Every event an athlete competed in during a week, each with its full scoring breakdown, summed into the weekly total. */
  private weekBreakdown(athleteId: string, week: number): Record<string, unknown> {
    const s = this.require();
    const a = this.athlete(athleteId);
    const mine = this.lines.filter((l) => l.athleteId === athleteId && l.week === week);
    const bySource = new Map<string, Line[]>();
    for (const l of mine) bySource.set(l.sourceId, [...(bySource.get(l.sourceId) ?? []), l]);
    const events: Record<string, unknown>[] = [];
    const extras: Record<string, unknown>[] = [];
    // Results the athlete competed in that earned nothing (e.g. 0-point lines) still appear, so nothing is hidden.
    const competed = [...this.results.values()].filter((r) => r.week === week && r.athleteIds.includes(athleteId) && !r.historyOnly);
    for (const r of competed) if (!bySource.has(r.id)) bySource.set(r.id, []);
    for (const [sid, ls] of bySource) {
      const total = round2(ls.reduce((t, l) => t + l.points, 0));
      const r = this.results.get(sid);
      if (!r) {
        const l0 = ls[0] as Line;
        extras.push({ sourceId: sid, event: l0.event, meet: l0.meet, date: l0.date, lines: ls.map((l) => this.lineView(l)), total });
        continue;
      }
      const best = ls.find((l) => l.code === "best");
      events.push({
        resultId: r.id, sourceResultId: r.sourceKey ?? null, eventId: r.eventId ?? null, meet: r.meet, meetId: r.meetId ?? null, date: r.date,
        event: r.event, relay: r.relay, relayTeam: r.relay ? this.names(r.athleteIds) : null, round: r.round ?? null, heat: r.heat ?? null,
        place: r.place, heatPlace: r.heatPlace, fieldSize: r.seeded, mark: describeMark(r.mark, r.event), status: r.status,
        pbsb: best ? best.label : "none", seedMark: r.seedMark ?? null, provisional: r.provisional === true, source: r.source,
        season: seasonOf(r.date, s.season), corrections: r.prev ?? [], detail: r.detail ?? "",
        lines: ls.map((l) => this.lineView(l)), total,
      });
    }
    events.sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.event).localeCompare(String(y.event)));
    const parts = [...events, ...extras].map((e) => Number(e.total));
    const sum = round2(parts.reduce((t, n) => t + n, 0));
    const weekly = round2(this.athleteWeek(athleteId, week));
    const starter = this.starterTeam(athleteId, week);
    const slot = starter ? STARTERS.find((x) => this.lineupFor(starter.id, week)[x] === athleteId) ?? null : null;
    return {
      athleteId, name: a.name, gender: a.gender, week, events, extras, eventCount: events.length,
      sumOfEvents: sum, weeklyTotal: weekly,
      check: { ok: Math.abs(sum - weekly) < 0.001, text: `${parts.map((p) => String(p)).join(" + ") || "0"} = ${sum}${Math.abs(sum - weekly) < 0.001 ? "" : ` ≠ stored ${weekly}`}` },
      starter: starter ? { teamId: starter.id, teamName: starter.teamName, slot } : null,
      matchupContribution: starter ? weekly : 0,
    };
  }

  /** A team's matchup total traced to every starter's complete weekly total (bench shown but not counted). */
  private teamBreakdown(teamId: string, week: number): Record<string, unknown> {
    const s = this.require();
    const t = this.team(teamId);
    const lineup = this.lineupFor(teamId, week);
    const row = (slot: SlotId): Record<string, unknown> => {
      const aid = lineup[slot];
      if (!aid) return { slot, athleteId: null, name: null, total: 0, events: [] };
      const b = this.weekBreakdown(aid, week);
      return { slot, athleteId: aid, name: b.name, total: b.weeklyTotal, check: b.check, events: (b.events as Record<string, unknown>[]).map((e) => ({ event: e.event, meet: e.meet, total: e.total, resultId: e.resultId })) };
    };
    const starters = STARTERS.map(row);
    const bench = SLOT_IDS.filter((x) => !STARTERS.includes(x)).map(row);
    const sum = round2(starters.reduce((n, r) => n + Number(r.total), 0));
    const m = s.schedule.find((x) => x.week === week && (x.homeId === teamId || x.awayId === teamId));
    const official = m ? this.matchScore(m, teamId) : this.teamWeekScore(teamId, week);
    return {
      teamId, teamName: t.teamName, week, starters, bench, starterSum: sum, matchupScore: official, final: m?.final ?? false,
      check: { ok: Math.abs(sum - official) < 0.001 || (m?.final ?? false), text: `${starters.map((r) => String(r.total)).join(" + ")} = ${sum}${m?.final ? ` (frozen at final: ${official})` : ""}` },
    };
  }

  /**
   * RECONCILE SCORES: independently recomputes raw data → normalized results → engine → event totals → weekly totals →
   * matchup totals, and compares with what is stored. Read-only. `plant` corrupts an in-memory COPY to prove detection.
   */
  private async reconcile(plant: boolean): Promise<Record<string, unknown>> {
    const s = this.require();
    const before = this.isolationPrint();
    const issues: { kind: string; severity: "mismatch" | "info"; detail: string }[] = [];
    const add = (kind: string, severity: "mismatch" | "info", detail: string): void => { issues.push({ kind, severity, detail: detail.slice(0, 300) }); };
    const stored = new Map(this.results);
    const storedLines = [...this.lines];
    const storedPts = JSON.parse(JSON.stringify(this.pts)) as Record<string, Record<string, number>>;
    let planted: Record<string, unknown> | null = null;
    if (plant) {
      const victim = [...stored.values()].find((r) => r.meetId && !r.historyOnly && r.source === "live");
      if (victim) stored.delete(victim.id);
      const l = storedLines.find((x) => x.points !== 0);
      if (l) {
        storedLines.push({ ...l });
        const wk = (storedPts[l.athleteId] ??= {});
        wk[String(l.week)] = round2((wk[String(l.week)] ?? 0) + l.points);
      }
      planted = { removedResult: victim ? `${this.names(victim.athleteIds)} · ${victim.event}` : null, duplicatedLine: l ? `${this.nameOf(l.athleteId)} · ${l.event} · ${l.label} (${l.points})` : null };
    }
    await this.loadLinks();
    const sigR = (r: Result): string => JSON.stringify([r.athleteIds, r.mark, r.place, r.heatPlace, r.seeded, r.status, r.provisional === true, r.historyOnly === true, r.pctPlace ?? null, r.week, r.event, r.best]);
    const fmt = (r: Result): string => `${r.status} ${r.mark || "—"} place ${r.place ?? "–"} heat ${r.heatPlace ?? "–"}`;
    const meets: Record<string, unknown>[] = [];
    for (const m of s.meets) {
      if (m.archived || m.isDemo) continue;
      const have = [...stored.values()].filter((r) => r.meetId === m.id && r.source === "live");
      if (m.status === "UPCOMING" && have.length === 0) continue;
      let feed: RawFeed;
      try {
        feed = await this.loadFeed(m);
      } catch (e) {
        add("source", "info", `${m.name}: raw data couldn't be re-read (${e instanceof Error ? e.message : "unavailable"}). Stored results kept; re-run later.`);
        meets.push({ meetId: m.id, name: m.name, reread: false, stored: have.length });
        continue;
      }
      const out = normalizeFeed(m.id, feed, m.status === "FINAL", Date.now(), s.eventMap);
      const a = this.analyze(m, out.rows);
      const built = this.buildLiveResults(m, out, a, m.status === "FINAL");
      const expected = new Map<string, Result>();
      for (const [rowId, r] of built) if (r) expected.set(`live${hash(rowId)}`, r);
      let missing = 0; let orphan = 0; let stale = 0;
      for (const [id, r] of expected) {
        const cur = stored.get(id);
        if (!cur) { missing++; add("missing-result", "mismatch", `${m.name}: ${this.names(r.athleteIds)} · ${r.event} is in the source but not stored.`); continue; }
        if (cur.locked) continue;
        if (sigR(cur) !== sigR(r)) { stale++; add("stale-result", "mismatch", `${m.name}: ${this.names(r.athleteIds)} · ${r.event}: stored ${fmt(cur)} vs source ${fmt(r)}.`); }
      }
      for (const r of have) if (!expected.has(r.id) && !r.locked) { orphan++; add("orphaned-result", "mismatch", `${m.name}: ${this.names(r.athleteIds)} · ${r.event} is stored but no longer in the source.`); }
      meets.push({ meetId: m.id, name: m.name, reread: true, sourceRows: out.rows.length, expected: expected.size, stored: have.length, missing, orphaned: orphan, stale });
    }
    // Duplicates: one stored result per source identity, one scoring line per id.
    const byKey = new Map<string, number>();
    for (const r of stored.values()) if (r.sourceKey) byKey.set(r.sourceKey, (byKey.get(r.sourceKey) ?? 0) + 1);
    for (const [k, n] of byKey) if (n > 1) add("duplicate-result", "mismatch", `Source result ${k} is stored ${n} times.`);
    const lineCount = new Map<string, number>();
    for (const l of storedLines) lineCount.set(l.id, (lineCount.get(l.id) ?? 0) + 1);
    for (const [id, n] of lineCount) if (n > 1) add("duplicate-line", "mismatch", `Scoring line ${id} is counted ${n} times (orphaned points).`);
    // Engine: recompute every line from the stored results.
    const fresh = computeAll(this.scoringInput([...stored.values()])).lines;
    const freshBy = new Map<string, number>();
    for (const l of fresh) freshBy.set(l.id, round2((freshBy.get(l.id) ?? 0) + l.points));
    const storedBy = new Map<string, number>();
    for (const l of storedLines) storedBy.set(l.id, round2((storedBy.get(l.id) ?? 0) + l.points));
    let lineMismatch = 0;
    for (const [id, p] of storedBy) {
      const f = freshBy.get(id);
      if (f === undefined) { lineMismatch++; add("orphaned-points", "mismatch", `Stored line ${id} (${p}) has no matching result.`); }
      else if (Math.abs(f - p) > 0.001 && (lineCount.get(id) ?? 1) === 1) { lineMismatch++; add("points-mismatch", "mismatch", `Line ${id}: stored ${p}, engine ${f}.`); }
    }
    for (const [id, p] of freshBy) if (!storedBy.has(id)) { lineMismatch++; add("missing-points", "mismatch", `Engine line ${id} (${p}) isn't stored.`); }
    // Player weekly totals + event-sum invariant.
    const freshPts: Record<string, Record<string, number>> = {};
    const perEvent = new Map<string, Map<string, number>>();
    for (const l of fresh) {
      const w = (freshPts[l.athleteId] ??= {});
      w[String(l.week)] = round2((w[String(l.week)] ?? 0) + l.points);
      const k = `${l.athleteId}|${l.week}`;
      const ev = perEvent.get(k) ?? new Map<string, number>();
      ev.set(l.sourceId, (ev.get(l.sourceId) ?? 0) + l.points);
      perEvent.set(k, ev);
    }
    let weeklyMismatch = 0; let invariantFail = 0; let playerWeeks = 0; let multiEvent = 0;
    const keys = new Set<string>([...Object.entries(freshPts), ...Object.entries(storedPts)].flatMap(([aid, w]) => Object.keys(w).map((wk) => `${aid}|${wk}`)));
    for (const k of keys) {
      const [aid, wk] = k.split("|") as [string, string];
      playerWeeks++;
      const f = freshPts[aid]?.[wk] ?? 0;
      const st = storedPts[aid]?.[wk] ?? 0;
      if (Math.abs(f - st) > 0.001) { weeklyMismatch++; add("weekly-total", "mismatch", `${this.nameOf(aid)} week ${wk}: stored ${st}, recomputed ${f}.`); }
      const evs = perEvent.get(k);
      if (evs && evs.size > 1) multiEvent++;
      const sumEv = round2([...(evs?.values() ?? [])].reduce((t, n) => t + n, 0));
      if (Math.abs(sumEv - f) > 0.001) { invariantFail++; add("event-sum", "mismatch", `${this.nameOf(aid)} week ${wk}: events sum to ${sumEv} but weekly total is ${f}.`); }
    }
    // Matchups: starters only.
    const teamFrom = (pts: Record<string, Record<string, number>>, teamId: string, week: number): number => {
      const lineup = this.lineupFor(teamId, week);
      return round2(STARTERS.reduce((t, slot) => t + (lineup[slot] ? pts[lineup[slot] as string]?.[String(week)] ?? 0 : 0), 0));
    };
    let matchupMismatch = 0; const matchups: Record<string, unknown>[] = [];
    for (const m of s.schedule) {
      if (m.week > s.week) continue;
      for (const side of [m.homeId, m.awayId]) {
        if (!side) continue;
        const recomputed = teamFrom(freshPts, side, m.week);
        const storedScore = m.final ? this.matchScore(m, side) : teamFrom(storedPts, side, m.week);
        const ok = Math.abs(recomputed - storedScore) < 0.001;
        if (!ok && !m.final) { matchupMismatch++; add("matchup", "mismatch", `Week ${m.week} ${this.team(side).teamName}: stored ${storedScore}, recomputed ${recomputed}.`); }
        if (!ok && m.final) add("matchup-final", "info", `Week ${m.week} ${this.team(side).teamName}: finalized at ${storedScore}; today's data gives ${recomputed}. Finished weeks are never changed automatically.`);
        matchups.push({ week: m.week, teamId: side, team: this.team(side).teamName, stored: storedScore, recomputed, final: m.final, ok });
      }
    }
    const mismatches = issues.filter((i) => i.severity === "mismatch").length;
    const after = this.isolationPrint();
    const out: Record<string, unknown> = {
      at: Date.now(), ok: mismatches === 0, mismatches, planted,
      counts: {
        meets: meets.length, results: stored.size, scoringLines: storedLines.length, playerWeeks, multiEventPlayerWeeks: multiEvent, matchupSides: matchups.length,
        lineMismatches: lineMismatch, weeklyMismatches: weeklyMismatch, eventSumFailures: invariantFail, matchupMismatches: matchupMismatch,
      },
      verdict: mismatches === 0 ? "PASS: raw data, results, scoring lines, weekly totals and matchup totals all agree." : `FOUND ${mismatches} PROBLEM${mismatches === 1 ? "" : "S"}: nothing was changed. Review below, then Reprocess the meet or restore a snapshot.`,
      meets, matchups: matchups.slice(0, 80), issues: issues.slice(0, 200), isolation: { unchanged: before === after },
    };
    if (!plant) await this.ctx.storage.put("recon:last", { at: out.at, ok: out.ok, mismatches, counts: out.counts });
    return out;
  }

  /** Commissioner health dashboard. */
  private async health(): Promise<Record<string, unknown>> {
    const s = this.require();
    await this.loadLinks();
    const now = Date.now();
    const pool = s.athletes;
    const open = s.unmatched.filter((u) => u.status === "open");
    const dupes: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const x = pool[i] as Athlete; const y = pool[j] as Athlete;
        if (x.gender !== y.gender) continue;
        if (identityKey(x.name) === identityKey(y.name) || looseNameMatch(x.name, y.name)) dupes.push(`${x.name} / ${y.name}`);
      }
    }
    const log = (await this.ctx.storage.get<NoteLog[]>("notelog")) ?? [];
    const recon = await this.ctx.storage.get<Record<string, unknown>>("recon:last");
    let proj: Record<string, unknown>;
    try {
      const ids = pool.map((a) => a.id).sort();
      const p = this.projectFor(ids, s.week);
      const vals = Object.values(p);
      const states: Record<string, number> = {};
      for (const v of vals) states[v.state] = (states[v.state] ?? 0) + 1;
      proj = { states, generated: vals.filter((v) => v.available).length, missing: vals.filter((v) => !v.available).length, stale: this.weekStale(s.week), errors: 0, modelVersion: MODEL_VERSION, week: s.week };
    } catch (e) {
      proj = { generated: 0, missing: pool.length, stale: false, errors: 1, error: String(e).slice(0, 160) };
    }
    const results = [...this.results.values()];
    const integ = s.integrity ?? { unchanged: 0, corrections: 0, removed: 0, imports: 0 };
    return {
      at: now, isMainLeague: this.isMain(),
      athletes: {
        master: pool.length, cornwall: pool.filter((a) => isPoolSchool(poolSchoolOf(a.school))).length,
        needsReview: open.filter((u) => u.kind === "athlete" || u.kind === "relay").length, unmatched: open.length,
        duplicateCandidates: dupes.length, duplicateExamples: dupes.slice(0, 12),
        sourceConflicts: [...this.links.values()].filter((l) => !!l.conflict).length, sourceLinks: this.links.size, aliases: this.aliases.size,
      },
      meets: s.meets.filter((m) => !m.archived).map((m) => ({
        id: m.id, name: m.name, week: m.week, status: m.status, live: m.polling, history: m.history === true, rehearsal: m.testMeet === true,
        sourceStatus: m.sourceError ? `Problem: ${m.sourceError}` : m.lastSyncedAt ? "OK" : "Not read yet",
        lastSuccess: m.lastSyncedAt, lastAttempt: m.lastAttemptAt, freshnessMin: m.lastSyncedAt ? Math.round((now - m.lastSyncedAt) / 60_000) : null,
        events: m.stats.events, results: m.stats.processed, scored: results.filter((r) => r.meetId === m.id && !r.historyOnly).length,
      })),
      scoring: {
        imported: results.length, scored: results.filter((r) => !r.historyOnly).length, historyOnly: results.filter((r) => r.historyOnly).length,
        lines: this.lines.length, rejected: open.filter((u) => u.kind === "mark" || u.kind === "event").length,
        duplicatesBlocked: integ.unchanged, corrections: integ.corrections, removedByCorrection: integ.removed, imports: integ.imports,
        simultaneousImportsSerialized: this.syncStats.serialized,
        mismatches: recon ? recon.mismatches : null, lastReconcileAt: recon ? recon.at : null,
        versions: this.global ? versionsAt(this.global, Number.POSITIVE_INFINITY).label : "league rules",
      },
      notifications: {
        queued: log.filter((l) => l.status === "queued" || l.status === "sent").length, delivered: log.filter((l) => l.status === "delivered").length,
        noDevices: log.filter((l) => l.status === "no-devices").length, failed: log.filter((l) => l.status === "failed").length,
        skipped: log.filter((l) => l.status === "skipped").length, duplicatesBlocked: s.noteDupes ?? 0, logged: log.length,
      },
      projections: proj,
    };
  }

  /**
   * PREVIEW (never saves): what a scoring-rule or table change would do. Current → New, then a real athlete's
   * old → new score from real results (this league's, or the last Meet Test Lab run's real meet).
   */
  private async previewChange(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const g = this.global;
    if (!g) throw new ActionError("Global settings couldn't be loaded.");
    const cur = currentRules(g);
    const next = body.rules && typeof body.rules === "object" ? cleanScoring({ ...cur, ...(body.rules as Record<string, unknown>) }, cur) : cur;
    const diff = (Object.keys(next) as (keyof ScoringConfig)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k])).map((k) => ({ key: String(k), currentText: JSON.stringify(cur[k]), nextText: JSON.stringify(next[k]) }));
    let problems: string[] = [];
    let table: Record<string, unknown> | null = null;
    const base0 = this.scoringInput([]);
    let perf = base0.performance ?? [];
    if (body.table && typeof body.table === "object") {
      const t = body.table as Record<string, unknown>;
      const event = String(t.event ?? "");
      const gender = String(t.gender ?? "B") === "G" ? "G" : String(t.gender ?? "") === "X" ? "X" : "B";
      const season = clampInt(t.season, 2000, 2100, this.require().season);
      const tiers = (Array.isArray(t.tiers) ? (t.tiers as Record<string, unknown>[]) : []).map((x) => ({ mark: String(x.mark ?? ""), points: Number(x.points) }));
      problems = tiers.length ? validateTable(event, tiers) : [];
      const hit = PERFORMANCE_EVENTS.find((e) => keyOf(e) === keyOf(event)) ?? event;
      const curRows = perf.filter((p) => p.scope === "global" && (p.until === undefined || p.until === null) && p.season === season && p.gender === gender && keyOf(p.event) === keyOf(hit));
      table = { event: hit, gender, season, current: curRows.map((p) => ({ mark: p.mark, points: p.points })).sort((a, b) => a.points - b.points), next: tiers };
      if (problems.length === 0) {
        const measurement = measurementTypeOf(hit) ?? "TIME";
        perf = [...perf.filter((p) => !curRows.includes(p)), ...tiers.map((x, i) => ({
          id: `preview-${i}`, season, gender: gender as Gender | "X", event: hit, measurement, mark: x.mark, value: measureForEvent(x.mark, hit).m?.value ?? 0,
          points: x.points, active: true, updatedAt: Date.now(), since: 0, until: null, scope: "global" as const,
        }))];
      }
    }
    let results = [...this.results.values()];
    let source = `${results.length} real results in this league`;
    if (results.filter((r) => !r.historyOnly).length === 0) {
      const lab = await this.ctx.storage.get<{ meet: string; date: string; results: Result[] }>("lab:lastResults");
      results = lab?.results ?? [];
      source = lab ? `last Meet Test Lab run: ${lab.meet} (${lab.date}), ${results.length} real Cornwall results` : "no real results yet (run the Meet Test Lab on a past meet first)";
    }
    const base = this.scoringInput(results);
    const oldLines = computeAll(base).lines;
    const newLines = computeAll({ ...base, rulesFor: (): ScoringConfig => next, performance: perf }).lines;
    const tot = (ls: Line[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const l of ls) m.set(`${l.athleteId}|${l.week}`, round2((m.get(`${l.athleteId}|${l.week}`) ?? 0) + l.points));
      return m;
    };
    const o = tot(oldLines); const n = tot(newLines);
    const changed = [...new Set([...o.keys(), ...n.keys()])].map((k) => ({ k, old: o.get(k) ?? 0, next: n.get(k) ?? 0 })).filter((x) => Math.abs(x.old - x.next) > 0.001)
      .sort((x, y) => Math.abs(y.next - y.old) - Math.abs(x.next - x.old));
    const ex = changed[0];
    let example: Record<string, unknown> | null = null;
    if (ex) {
      const [aid, wk] = ex.k.split("|") as [string, string];
      const pick = (ls: Line[]): { event: string; meet: string; label: string; points: number }[] => ls.filter((l) => l.athleteId === aid && String(l.week) === wk).map((l) => ({ event: l.event, meet: l.meet, label: l.label, points: l.points }));
      example = { athleteId: aid, name: this.maybeAthlete(aid)?.name ?? aid, week: Number(wk), oldScore: ex.old, newScore: ex.next, oldLines: pick(oldLines), newLines: pick(newLines) };
    }
    const finished = new Set(changed.map((c) => Number(c.k.split("|")[1])).filter((w) => this.weekClosedAt(w) !== Number.POSITIVE_INFINITY));
    return {
      ok: problems.length === 0, problems, diff, table, source, athletesAffected: changed.length, example,
      finishedWeeksProtected: [...finished].sort((a, b) => a - b),
      note: "Finished weeks keep the scores they were finalized with. Open weeks (and every league) switch to the new version as soon as you publish.",
      currentVersion: versionsAt(g, Number.POSITIVE_INFINITY),
    };
  }

  // MARK: - Commissioner Admin Panel

  /**
   * Who may open the Admin Panel here (checked on EVERY admin request, never only hidden in the app):
   *   global  — the Main League, by the Main League commissioner account. Scoring publishes go to every league via the Directory.
   *   sandbox — a throwaway test league (qaSandbox) by its commissioner, or any league the Main League commissioner runs.
   *             Scoring publishes change only that league's sandbox rules.
   */
  private adminMode(userId: string): { mode: "global" | "sandbox" | null; reason: string } {
    const s = this.require();
    const g = this.global;
    if (s.commissionerId !== userId) return { mode: null, reason: "Only the commissioner can open the Admin Panel." };
    if (this.isMain()) return g?.mainCommissionerId === userId ? { mode: "global", reason: "Main League commissioner" } : { mode: null, reason: "Only the Main League commissioner account can open the Admin Panel." };
    if (g?.mainCommissionerId === userId) return { mode: "sandbox", reason: "Main League commissioner in another league: sandbox only" };
    if (s.qaSandbox) return { mode: "sandbox", reason: "Test league sandbox" };
    return { mode: null, reason: "Only the Main League commissioner account can open the Admin Panel." };
  }

  private async adminLog(user: User, kind: "draft" | "preview" | "publish" | "restore" | "refresh" | "validate", text: string): Promise<void> {
    const log = (await this.ctx.storage.get<{ at: number; by: string; kind: string; text: string }[]>("admin:log")) ?? [];
    log.push({ at: Date.now(), by: user.name, kind, text: text.slice(0, 400) });
    await this.ctx.storage.put("admin:log", log.slice(-300));
  }

  /** Rules the scoring editor starts from: this league's sandbox (test leagues) or the live global rules. */
  private adminCurrentRules(mode: "global" | "sandbox"): { rules: ScoringConfig; version: number; label: string } {
    const g = this.global;
    const sb = this.require().sandboxRules ?? [];
    const last = sb[sb.length - 1];
    if (mode === "sandbox" && last) return { rules: last.rules, version: last.version, label: `Test-league sandbox v${last.version}` };
    const cur = g ? currentRules(g) : DEFAULT_SCORING;
    return { rules: cur, version: g?.scoringVersion ?? 0, label: g ? versionsAt(g, Number.POSITIVE_INFINITY).label : "league rules" };
  }

  private async adminOp(user: User, op: string, a: Record<string, unknown>): Promise<Record<string, unknown>> {
    const s = this.require();
    const access = this.adminMode(user.id);
    if (op === "adminAccess") {
      return {
        allowed: access.mode !== null, mode: access.mode, reason: access.reason, isMainLeague: this.isMain(), leagueName: s.name,
        limits: "The Admin Panel manages settings and data only. It can't change the app's code, add features or change the database structure.",
      };
    }
    if (!access.mode) throw new ForbiddenError(access.reason);
    const mode = access.mode;
    switch (op) {
      case "draftLoad": {
        const d = await this.ctx.storage.get<{ rules: ScoringConfig; at: number; by: string; baseVersion: number }>(`admin:draft:${mode}`);
        const cur = this.adminCurrentRules(mode);
        return { ok: true, mode, draft: d ?? null, current: cur, categories: CATEGORIES };
      }
      case "draftSave": {
        const cur = this.adminCurrentRules(mode);
        const rules = cleanScoring({ ...cur.rules, ...((a.rules ?? {}) as Record<string, unknown>) }, cur.rules);
        const d = { rules, at: Date.now(), by: user.name, baseVersion: cur.version };
        await this.ctx.storage.put(`admin:draft:${mode}`, d);
        const changed = (Object.keys(rules) as (keyof ScoringConfig)[]).filter((k) => JSON.stringify(rules[k]) !== JSON.stringify(cur.rules[k]));
        await this.adminLog(user, "draft", `Draft saved (${changed.length ? changed.join(", ") : "no changes"}) — nothing published`);
        return { ok: true, message: `Draft saved. ${changed.length} change${changed.length === 1 ? "" : "s"} from ${cur.label}. Nothing was published.`, draft: d };
      }
      case "draftClear": {
        await this.ctx.storage.delete(`admin:draft:${mode}`);
        await this.adminLog(user, "draft", "Draft discarded");
        return { ok: true, message: "Draft discarded. Nothing was published." };
      }
      case "draftPreview": {
        const d = await this.ctx.storage.get<{ rules: ScoringConfig }>(`admin:draft:${mode}`);
        const cur = this.adminCurrentRules(mode);
        const rules = (a.rules as Record<string, unknown> | undefined) ?? d?.rules;
        if (!rules) throw new ActionError("Save a draft first.");
        const before = this.fingerprint();
        const out = mode === "sandbox" ? this.previewSandbox(cur.rules, cleanScoring({ ...cur.rules, ...rules }, cur.rules)) : await this.previewChange({ rules });
        await this.adminLog(user, "preview", `Previewed draft: ${String((out.athletesAffected as number | undefined) ?? 0)} athlete-weeks would change`);
        return { ...out, ok: true, mode, unchanged: before.hash === this.fingerprint().hash };
      }
      case "sandboxPublish":
      case "sandboxRestore": {
        if (mode !== "sandbox" || this.isMain()) throw new ForbiddenError("Main League scoring is published to every league through the global scoring editor.");
        if (String(a.confirm ?? "") !== "PUBLISH") throw new ActionError("Type PUBLISH to confirm.");
        const rid = String(a.requestId ?? "");
        const seen = (await this.ctx.storage.get<string[]>("admin:rids")) ?? [];
        if (rid && seen.includes(rid)) return { ok: true, duplicate: true, message: "Already published (duplicate tap ignored)." };
        const cur = this.adminCurrentRules("sandbox");
        let next: ScoringConfig;
        let note: string;
        if (op === "sandboxRestore") {
          const v = Number(a.version);
          const old = (s.sandboxRules ?? []).find((x) => x.version === v);
          const g = this.global;
          const oldG = g?.rules.find((x) => (x.version ?? 0) === v);
          const src = a.source === "global" ? oldG?.rules : old?.rules;
          if (!src) throw new ActionError(`Version ${v} wasn't found.`);
          next = cleanScoring(src, cur.rules);
          note = `Restored ${a.source === "global" ? "global" : "sandbox"} v${v} as a new version`;
        } else {
          const d = await this.ctx.storage.get<{ rules: ScoringConfig }>("admin:draft:sandbox");
          const raw = (a.rules as Record<string, unknown> | undefined) ?? d?.rules;
          if (!raw) throw new ActionError("Nothing to publish: save a draft first.");
          next = cleanScoring({ ...cur.rules, ...raw }, cur.rules);
          note = "Published draft";
        }
        if (JSON.stringify(next) === JSON.stringify(cur.rules) && (s.sandboxRules ?? []).length > 0) return { ok: true, message: "No changes: these rules are already live in this test league." };
        const frozen = this.fingerprint();
        const list = s.sandboxRules ?? [];
        const version = (list[list.length - 1]?.version ?? 0) + 1;
        s.sandboxRules = [...list, { since: Date.now(), version, rules: next, by: user.name, note }].slice(-50);
        this.audit(user, "sandbox.scoring", `${note}: sandbox v${version}`);
        this.recompute();
        this.projCache.clear();
        await this.persistAdmin();
        const after = this.fingerprint();
        await this.ctx.storage.put("admin:rids", [...seen, rid].filter(Boolean).slice(-50));
        if (op === "sandboxPublish") await this.ctx.storage.delete("admin:draft:sandbox");
        await this.adminLog(user, op === "sandboxRestore" ? "restore" : "publish", `${note} → sandbox v${version} (this test league only)`);
        return {
          ok: true, version, message: `Sandbox scoring v${version} is live in this test league only. Finished weeks kept their scores.`,
          finishedWeeksUnchanged: frozen.hash === after.hash, finishedWeeks: after.weeks.length,
        };
      }
      case "adminVersions": {
        const g = this.global;
        return {
          ok: true, mode,
          global: (g?.rules ?? []).map((r) => ({ version: r.version ?? 0, since: r.since, by: r.by ?? null, rules: r.rules })).reverse(),
          sandbox: (s.sandboxRules ?? []).map((r) => ({ version: r.version, since: r.since, by: r.by, note: r.note, rules: r.rules })).reverse(),
          current: this.adminCurrentRules(mode),
        };
      }
      case "changelog": {
        const g = this.global;
        const mine = ((await this.ctx.storage.get<{ at: number; by: string; kind: string; text: string }[]>("admin:log")) ?? []).map((x) => ({ ...x, scope: "this league" }));
        const glob = (g?.audit ?? []).filter((x) => x.action.startsWith("scoring") || x.action.startsWith("performance") || x.action.startsWith("standard"))
          .map((x) => ({ at: x.at, by: x.actorName, kind: "publish", text: `${x.action}: ${x.detail}`, scope: "all leagues" }));
        const local = s.audit.filter((x) => x.action.startsWith("sandbox") || x.action.startsWith("meet.") || x.action.startsWith("result")).slice(-80)
          .map((x) => ({ at: x.at, by: x.actorName, kind: x.action.startsWith("sandbox") ? "publish" : "data", text: `${x.action}: ${x.detail}`, scope: "this league" }));
        return { ok: true, entries: [...mine, ...glob, ...local].sort((x, y) => y.at - x.at).slice(0, 200) };
      }
      case "projHealth": {
        const t0 = Date.now();
        if (a.refresh === true) this.projCache.clear();
        const ids = s.athletes.map((x) => x.id).sort();
        const target = this.targetWeek(s.week);
        const now = this.projectFor(ids, s.week);
        const next = target === s.week ? now : this.projectFor(ids, target);
        const outlook = this.outlookFor(ids);
        const count = (p: Record<string, Projection>): Record<string, number> => {
          const c: Record<string, number> = {};
          for (const v of Object.values(p)) c[v.state] = (c[v.state] ?? 0) + 1;
          return c;
        };
        const owned = new Map<string, string>();
        for (const tm of s.teams) for (const id of this.rosterOf(tm)) owned.set(id, tm.teamName);
        const results = [...this.results.values()];
        const zeros = s.athletes.filter((x) => (next[x.id]?.projected ?? 0) <= 0).map((x) => {
          const p = next[x.id];
          const mine = results.filter((r) => r.athleteIds.includes(x.id) && !r.relay);
          const pbs = Object.keys(this.scoring.pbs[x.id] ?? {}).length;
          const o = outlook[x.id];
          return {
            athleteId: x.id, name: x.name, team: owned.get(x.id) ?? null, state: p?.state ?? "insufficient", label: p?.stateLabel ?? "Not enough data", reason: p?.note ?? "",
            actual: p?.actual ?? 0, resultsOnFile: mine.length, lastResult: mine.map((r) => r.date).sort().pop() ?? null, pbsOnFile: pbs,
            outlookPerMeet: o?.state === "projected" ? o.projected : null,
            diagnosis: mine.length === 0 && pbs === 0 ? "No history: no results or PB matched to this athlete." : p?.state === "insufficient" ? "History exists but too sparse to project an entry." : p?.state === "notEntered" ? "Not on the published entries." : p?.state === "finished" ? "Week over: real zero." : p?.state === "noMeet" ? "No meet this week." : "",
          };
        }).sort((x, y) => x.state.localeCompare(y.state) || x.name.localeCompare(y.name));
        if (a.refresh === true) await this.adminLog(user, "refresh", `Projections recalculated for ${ids.length} athletes (week ${target})`);
        return {
          ok: true, modelVersion: MODEL_VERSION, currentWeek: s.week, targetWeek: target, ms: Date.now() - t0, athletes: ids.length,
          currentWeekStates: count(now), targetWeekStates: count(next), outlookAvailable: Object.values(outlook).filter((v) => v.state === "projected").length,
          zeros: zeros.slice(0, 400), message: a.refresh === true ? `Projections recalculated for ${ids.length} athletes in ${Date.now() - t0} ms.` : undefined,
          rules: this.adminCurrentRules(mode).label,
        };
      }
      case "validateData": {
        const results = [...this.results.values()];
        const pool = new Set(s.athletes.map((x) => x.id));
        const byKey = new Map<string, number>();
        for (const r of results) byKey.set(r.key, (byKey.get(r.key) ?? 0) + 1);
        const weeks = new Set(s.schedule.map((m) => m.week));
        const meets = s.meets.filter((m) => !m.archived && !m.isDemo).map((m) => {
          const rs = results.filter((r) => r.meetId === m.id);
          const dup = rs.filter((r) => (byKey.get(r.key) ?? 0) > 1).length;
          const orphan = rs.filter((r) => r.athleteIds.some((id) => !pool.has(id))).length;
          const entered = Object.entries(m.entryEvents ?? {});
          const missing = m.status === "FINAL" ? entered.filter(([aid, evs]) => evs.some((ev) => !rs.some((r) => r.athleteIds.includes(aid) && keyOf(eventInfo(r.event).name) === keyOf(ev)))).length : 0;
          const problems = [
            ...(dup ? [`${dup} duplicate result${dup === 1 ? "" : "s"}`] : []),
            ...(orphan ? [`${orphan} result${orphan === 1 ? "" : "s"} linked to athletes no longer in the pool`] : []),
            ...(missing ? [`${missing} entered athlete${missing === 1 ? "" : "s"} with no result after FINAL`] : []),
            ...(!m.history && !weeks.has(m.week) && s.phase === "season" ? [`Week ${m.week} has no matchups`] : []),
            ...(m.sourceError ? [`Source: ${m.sourceError}`] : []),
            ...(!m.sourceUrl && m.provider !== "MANUAL" ? ["No meet link"] : []),
          ];
          return {
            id: m.id, name: m.name, date: m.date, week: m.week, status: m.status, scope: m.scope ?? "local", rehearsal: m.testMeet === true, history: m.history === true,
            sourceUrl: m.sourceUrl ?? null, results: rs.length, scored: rs.filter((r) => !r.historyOnly).length, entries: entered.length, ok: problems.length === 0, problems,
          };
        });
        const open = s.unmatched.filter((u) => u.status === "open");
        await this.loadLinks();
        await this.adminLog(user, "validate", `Data check: ${meets.filter((m) => !m.ok).length} meet(s) with problems, ${open.length} open review items`);
        return {
          ok: true, meets, results: results.length, duplicateKeys: [...byKey.values()].filter((n) => n > 1).length,
          needsReview: { athletes: open.filter((u) => u.kind === "athlete" || u.kind === "relay").length, marks: open.filter((u) => u.kind === "mark" || u.kind === "event").length, total: open.length },
          athleteLinks: this.links.size, linkConflicts: [...this.links.values()].filter((l) => !!l.conflict).length,
          note: "Read-only check. Fixes go through Needs Review, Correct result, Reprocess or Re-sync, each with its own confirmation.",
        };
      }
      case "liveActivityPreview": {
        await this.ensureSharedHistory();
        const week = clampInt(a.week, 1, 60, s.week);
        return { ok: true, week, end: a.end === true, activities: this.liveActivityContent(week, a.end === true) };
      }
      case "scoringExport": {
        // Read-only: the exact inputs and lines of this league's scoring, for an independent re-calculation.
        const real = this.scoringInput([...this.results.values()]);
        // Optional rule variant (test leagues only): every week re-scored under it in memory. Nothing is saved.
        const variant = a.variant && typeof a.variant === "object" && mode === "sandbox" && !this.isMain()
          ? cleanScoring({ ...(real.rulesFor?.(s.week) ?? DEFAULT_SCORING), ...(a.variant as Record<string, unknown>) }, real.rulesFor?.(s.week) ?? DEFAULT_SCORING) : null;
        const input: ScoringInput = variant ? { ...real, rulesFor: (): ScoringConfig => variant } : real;
        const outLines = variant ? computeAll(input).lines : this.lines;
        const weeks = [...new Set([...this.results.values()].map((r) => r.week))].sort((x, y) => x - y);
        const seasons = new Set([...this.results.values()].map((r) => r.season ?? seasonOf(r.date, input.season)));
        const act = input.ruleActive ?? ((): boolean => true);
        const perf: Record<string, unknown[]> = {};
        const stds: Record<string, unknown[]> = {};
        for (const w of weeks) {
          perf[w] = (input.performance ?? []).filter((p) => p.active && seasons.has(p.season) && act(p, w)).map((p) => [p.season, p.gender, keyOf(p.event), p.value, p.points, p.mark]);
          stds[w] = input.standards.filter((x) => x.active && seasons.has(x.season) && act(x, w)).map((x) => [x.season, x.gender, keyOf(x.event), x.mark, x.points, x.type]);
        }
        return {
          ok: true, season: input.season, legacyHeatBeforeWeek: input.legacyHeatBeforeWeek ?? 0,
          rules: Object.fromEntries(weeks.map((w) => [w, input.rulesFor?.(w) ?? DEFAULT_SCORING])),
          performance: perf, standards: stds, pbs: input.pbs, records: input.records, fumbles: input.fumbles,
          results: [...this.results.values()].map((r) => ({
            id: r.id, week: r.week, date: r.date, season: r.season ?? null, event: r.event, gender: r.gender, athleteIds: r.athleteIds, relay: r.relay, mark: r.mark,
            place: r.place, heatPlace: r.heatPlace, pctPlace: r.pctPlace ?? null, seeded: r.seeded, status: r.status, best: r.best, historyOnly: r.historyOnly === true,
            provisional: r.provisional === true, section: r.section ?? null, source: r.source, seq: r.seq ?? 1, sourceKey: r.sourceKey ?? null, enteredAt: r.enteredAt, meetId: r.meetId ?? null,
          })),
          variant: variant !== null,
          lines: outLines.map((l) => ({ id: l.id, athleteId: l.athleteId, week: l.week, sourceId: l.sourceId, code: l.code, points: l.points, label: l.label })),
          teams: Object.fromEntries(s.teams.map((t) => [t.id, Object.fromEntries(weeks.map((w) => [w, this.teamWeekScore(t.id, w)]))])),
          lineups: Object.fromEntries(s.teams.map((t) => [t.id, Object.fromEntries(weeks.map((w) => [w, this.lineupFor(t.id, w)]))])),
        };
      }
      case "projMeets": return this.projMeetsView(mode);
      case "projMeetPreview": {
        const { pm, text } = await this.projMeetFrom(a, user.name);
        const pv: ProjMeet = { ...pm, id: `pv-${pm.id}` };
        if (text !== null) await this.ctx.storage.put(`projmeets:text:${pv.id}`, text);
        try {
          const got = await this.readProjMeet(pv);
          const exists = (await this.projMeetList()).some((m) => m.id === pm.id);
          const athletes = [...new Set(got.results.flatMap((r) => r.athleteIds))];
          return {
            ok: true, preview: { ...pm, stat: null }, exists,
            rows: got.rows, events: got.events, poolRows: got.poolRows, results: got.results.length, athletes: athletes.length, skipped: got.skipped,
            sample: athletes.slice(0, 12).map((id) => ({ id, name: this.nameOf(id), marks: got.results.filter((r) => r.athleteIds[0] === id).map((r) => `${eventInfo(r.event).name} ${r.mark}`).slice(0, 4) })),
            message: got.results.length > 0
              ? `${pm.name} (${pm.date}): ${got.results.length} marks for ${athletes.length} Cornwall Central athletes. Nothing saved yet.`
              : `${pm.name}: no Cornwall Central athletes were matched. Nothing saved.`,
          };
        } finally {
          if (text !== null) await this.ctx.storage.delete(`projmeets:text:${pv.id}`);
        }
      }
      case "projMeetAdd":
      case "projMeetRemove":
      case "projMeetsRebuild": {
        const rid = String(a.requestId ?? "");
        const seen = (await this.ctx.storage.get<string[]>("projmeets:rids")) ?? [];
        if (rid && seen.includes(rid)) return { ...(await this.projMeetsView(mode)), duplicate: true, message: "Already done (duplicate tap ignored)." };
        if (this.libBuild) throw new ActionError("A rebuild is already running. Try again in a minute.");
        const list = await this.projMeetList();
        let next = list;
        let note = "";
        if (op === "projMeetAdd") {
          const { pm, text } = await this.projMeetFrom(a, user.name);
          if (list.some((m) => m.id === pm.id)) throw new ActionError(`${pm.name} is already in the list.`);
          if (list.length >= 40) throw new ActionError("The list holds up to 40 meets. Remove one first.");
          if (text !== null) await this.ctx.storage.put(`projmeets:text:${pm.id}`, text);
          const got = await this.readProjMeet(pm).catch((e: unknown) => { throw new ActionError(e instanceof SourceError ? e.message : "The meet couldn't be read."); });
          if (got.results.length === 0) {
            if (text !== null) await this.ctx.storage.delete(`projmeets:text:${pm.id}`);
            throw new ActionError(`${pm.name}: no Cornwall Central athletes were matched, so it wasn't added.`);
          }
          await this.ctx.storage.put(`projlib:m:${pm.id}`, got.results);
          next = [...list, pm];
          note = `Added ${pm.name} (${pm.date}): ${got.results.length} marks`;
        } else if (op === "projMeetRemove") {
          const id = String(a.id ?? "");
          const hit = list.find((m) => m.id === id);
          if (!hit) throw new ActionError("That meet isn't in the list.");
          next = list.filter((m) => m.id !== id);
          await this.ctx.storage.delete([`projlib:m:${id}`, `projmeets:text:${id}`]);
          note = `Removed ${hit.name} (${hit.date})`;
        } else note = "Rebuilt every projection meet";
        await this.ctx.storage.put("projmeets:list", next);
        if (op === "projMeetsRebuild") {
          await this.projectionLibrary(true);
        } else {
          // Keep each meet's stored rows; only the index changes (no full re-download).
          const idx = await this.ctx.storage.get<Omit<ProjLib, "byMeet">>("projlib:index");
          const stats = { ...(idx?.stats ?? {}) };
          if (op === "projMeetAdd") {
            const pm = next[next.length - 1] as ProjMeet;
            const rs = (await this.ctx.storage.get<Result[]>(`projlib:m:${pm.id}`)) ?? [];
            stats[pm.id] = { at: Date.now(), results: rs.length, athletes: new Set(rs.flatMap((r) => r.athleteIds)).size, error: null };
          } else delete stats[String(a.id ?? "")];
          await this.ctx.storage.put("projlib:index", { at: idx?.at ?? Date.now(), sig: hash(JSON.stringify(next.map((m) => [m.id, m.date, m.name]))), stats });
        }
        await this.ctx.storage.put("projmeets:rids", [...seen, rid].filter(Boolean).slice(-50));
        this.projCache.clear();
        this.libraryCache = null;
        if (mode === "global") await this.resetSharedProjectionHistory();
        this.audit(user, "projections.meets", note);
        await this.adminLog(user, "refresh", `${note} (projections only)`);
        const view = await this.projMeetsView(mode);
        return { ...view, message: `${note}. ${mode === "global" ? "Every league picks this up within 30 minutes." : "This test league's projections updated."} Real scoring is unchanged.` };
      }
      case "audit": return this.scoringAudit();
      case "backtestArmory": return this.armoryBacktest(a);
      case "fingerprint": return { ok: true, ...this.fingerprint() };
      case "enableSandbox": throw new ActionError("Use the league action to set up a test league.");
      default: throw new ActionError("Unknown admin tool.");
    }
  }

  private async persistAdmin(): Promise<void> {
    await this.save();
  }

  /** Finished weeks' line points and matchup scores: identical before/after any admin change proves they stayed frozen. */
  private fingerprint(): { hash: string; weeks: { week: number; hash: string; lines: number; points: number }[] } {
    const s = this.require();
    const closed = [...new Set(s.schedule.filter((m) => m.final).map((m) => m.week))].sort((x, y) => x - y);
    const weeks = closed.map((w) => {
      const ls = this.lines.filter((l) => l.week === w).map((l) => `${l.id}:${l.points}`).sort();
      const games = s.schedule.filter((m) => m.week === w).map((m) => `${m.id}:${this.matchScore(m, m.homeId)}:${m.awayId ? this.matchScore(m, m.awayId) : "bye"}`).sort();
      return { week: w, hash: hash(JSON.stringify([ls, games])), lines: ls.length, points: round2(this.lines.filter((l) => l.week === w).reduce((t, l) => t + l.points, 0)) };
    });
    return { hash: hash(JSON.stringify(weeks)), weeks };
  }

  /** Sandbox preview: same output shape as previewChange, against this league's own results and sandbox rules. */
  private previewSandbox(cur: ScoringConfig, next: ScoringConfig): Record<string, unknown> {
    const diff = (Object.keys(next) as (keyof ScoringConfig)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k])).map((k) => ({ key: String(k), currentText: JSON.stringify(cur[k]), nextText: JSON.stringify(next[k]) }));
    const base = this.scoringInput([...this.results.values()]);
    const oldLines = this.lines;
    // Open weeks switch to the new rules; finished weeks keep theirs.
    const newLines = computeAll({ ...base, rulesFor: (w: number): ScoringConfig => (this.weekClosedAt(w) === Number.POSITIVE_INFINITY ? next : (base.rulesFor?.(w) ?? cur)) }).lines;
    const tot = (ls: Line[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const l of ls) m.set(`${l.athleteId}|${l.week}`, round2((m.get(`${l.athleteId}|${l.week}`) ?? 0) + l.points));
      return m;
    };
    const o = tot(oldLines); const n = tot(newLines);
    const changed = [...new Set([...o.keys(), ...n.keys()])].map((k) => ({ k, old: o.get(k) ?? 0, next: n.get(k) ?? 0 })).filter((x) => Math.abs(x.old - x.next) > 0.001);
    const ex = changed.sort((x, y) => Math.abs(y.next - y.old) - Math.abs(x.next - x.old))[0];
    const finishedChanged = changed.filter((c) => this.weekClosedAt(Number(c.k.split("|")[1])) !== Number.POSITIVE_INFINITY).length;
    return {
      ok: true, problems: [], diff, table: null, source: `${this.results.size} real results in this test league`, athletesAffected: changed.length,
      example: ex ? { athleteId: ex.k.split("|")[0], name: this.nameOf(ex.k.split("|")[0] as string), week: Number(ex.k.split("|")[1]), oldScore: ex.old, newScore: ex.next, oldLines: [], newLines: [] } : null,
      finishedWeeksProtected: [...new Set(this.require().schedule.filter((m) => m.final).map((m) => m.week))].sort((x, y) => x - y),
      finishedWeekChanges: finishedChanged,
      note: "Preview only. Publishing changes this test league's open weeks only; finished weeks keep their scores. The Main League is never affected.",
      currentVersion: { scoring: (this.require().sandboxRules ?? []).slice(-1)[0]?.version ?? 0, tables: 0, label: "test-league sandbox" },
    };
  }

  /** Scoring audit + Baseline / Test A / Test B on this league's real results (read-only). */
  private scoringAudit(): Record<string, unknown> {
    const s = this.require();
    const { base, meets } = this.labBase();
    if (base.results.filter((r) => !r.historyOnly).length === 0) return { ok: false, message: "No scored results in this league yet." };
    const rules = base.rulesFor?.(1) ?? DEFAULT_SCORING;
    const season = Math.max(...base.results.map((r) => r.season ?? seasonOf(r.date, s.season)));
    const baseLines = computeLines(base);
    const rounds = new Map(s.draft.picks.map((p) => [p.athleteId, p.round]));
    const games: AuditGame[] = s.schedule.filter((m) => m.kind === "regular" || !m.kind).map((m) => ({
      week: m.week, label: m.id, home: this.startersOf(m.homeId, m.week), away: m.awayId ? this.startersOf(m.awayId, m.week) : null,
    }));
    const opts = { rounds, games, teams: Math.max(1, s.teams.length) };
    const b = scenarioMetrics(base, baseLines, opts);
    const baseline = { totals: b.totals, winners: b.winners, athleteMeet: b.athleteMeet };
    const aLines = scenarioLines(base, "testA");
    const bLines = scenarioLines(base, "testB");
    return {
      ok: true, at: Date.now(), published: false, meets, results: base.results.filter((r) => !r.historyOnly).length,
      rules, rulesVersion: this.global ? versionsAt(this.global, Number.POSITIVE_INFINITY).label : "league rules",
      max: maxBreakdown(rules, base.performance ?? [], base.standards, season),
      audit: auditLines(base, baseLines),
      scenarios: {
        baseline: b.metrics,
        testA: scenarioMetrics(base, aLines, { ...opts, baseline }).metrics,
        testB: scenarioMetrics(base, bLines, { ...opts, baseline }).metrics,
      },
      note: "Read-only. Nothing was published; Main League scoring is unchanged.",
    };
  }

  /** Strict no-peek back-test on this league's real meets (optionally only meets whose name matches). */
  private armoryBacktest(a: Record<string, unknown>): Record<string, unknown> {
    const { base, note, meets } = this.labBase();
    if (meets < 2) return { ok: false, message: "Back-testing needs at least two real meets in this league." };
    const only = Array.isArray(a.meets) ? (a.meets as unknown[]).map((x) => keyOf(String(x))) : null;
    const out = backtest(base, this.require().athletes.map((x) => ({ id: x.id, gender: x.gender })), 20, {
      strict: a.strict !== false, pool: a.pool !== false,
      only: only ? (k: string): boolean => only.some((m) => keyOf(k).includes(m)) : undefined,
    });
    return { ok: true, at: Date.now(), modelVersion: MODEL_VERSION, seasonNote: note, ...out };
  }

  // MARK: - Scoring labs (read-only)

  /** Complete-field profile (every school) for one meet import: size, strength, sorted marks/seed marks. */
  private profileOf(m: Meet, rows: NormalizedMeetResult[]): Meet["fieldProfile"] {
    try {
      const date = m.date || new Date().toISOString().slice(0, 10);
      const raw = seasonOf(date, this.require().season);
      const season = raw < 2026 && date >= "2025-11-01" ? 2026 : raw;
      const perf = [...this.scoring.performance, ...liveRows(this.global?.performance ?? [])];
      return profileFields(rows.map((r) => ({
        who: r.sourceAthleteId || `${r.firstName} ${r.lastName}|${r.school}`, gender: r.gender, event: r.event, mark: r.mark,
        seedMark: r.seedMark ?? null, status: r.resultStatus, relay: r.relay,
      })), perf, season);
    } catch (e) {
      console.warn("field profile failed", String(e));
      return m.fieldProfile;
    }
  }

  /** Real results in this league, scored every week under the rules in force NOW (labs compare formulas, not eras). */
  private labBase(): { base: ScoringInput; note: string | null; meets: number; history: Set<string> } {
    const raw = [...this.results.values()].filter((r) => r.provisional !== true);
    const history = new Set(raw.filter((r) => r.historyOnly).map((r) => r.id));
    const { results, seasonNote } = labResults(raw);
    const g = this.global;
    const rules = g ? currentRules(g) : DEFAULT_SCORING;
    const base = this.scoringInput(results);
    return {
      base: {
        ...base, rulesFor: (): ScoringConfig => rules, ruleActive: (): boolean => true,
        performance: g ? liveRows(g.performance) : this.scoring.performance, standards: g ? liveRows(g.standards) : this.scoring.standards,
      },
      note: seasonNote, meets: new Set(results.map((r) => `${r.date}|${r.meet}`)).size, history,
    };
  }

  private startersOf(teamId: string, week: number): string[] {
    const l = this.lineupFor(teamId, week);
    return STARTERS.map((slot) => l[slot]).filter((x): x is string => !!x);
  }

  /** Played fantasy matchups whose weeks have real (non-history) results, re-scored meet by meet. */
  private labContests(base: ScoringInput, history: Set<string>): Contest[] {
    const s = this.require();
    const byWeek = new Map<number, Set<string>>();
    for (const r of base.results) {
      if (history.has(r.id)) continue;
      const set = byWeek.get(r.week) ?? new Set<string>();
      set.add(`m:${r.date}|${r.meet}`);
      byWeek.set(r.week, set);
    }
    return s.schedule.filter((m) => byWeek.has(m.week)).map((m) => ({
      label: `${m.round ?? `Week ${m.week}`}`, keys: [...(byWeek.get(m.week) ?? [])],
      home: { id: m.homeId, name: this.team(m.homeId).teamName, ids: this.startersOf(m.homeId, m.week) },
      away: m.awayId ? { id: m.awayId, name: this.team(m.awayId).teamName, ids: this.startersOf(m.awayId, m.week) } : null,
    }));
  }

  private runLab(kind: "seed" | "relay"): Record<string, unknown> {
    const { base, note, meets: meetCount, history } = this.labBase();
    if (base.results.length === 0) {
      return { ok: false, message: "No real results in this league yet. Import a past AthleticLIVE meet first (rehearsal meet or Meet Test Lab)." };
    }
    const contests = this.labContests(base, history);
    const nameOf = (id: string): string => this.nameOf(id);
    const meets = new Map(this.require().meets.map((m) => [m.id, m]));
    const fieldOf = (r: Result): NonNullable<Meet["fieldProfile"]>[string] | undefined => (r.meetId ? meets.get(r.meetId)?.fieldProfile?.[`${r.gender}|${eventInfo(r.event).name}`] : undefined);
    const out = kind === "seed" ? seedLab(base, contests, nameOf, fieldOf) : relayLab(base, contests, nameOf);
    return {
      ok: true, kind, at: Date.now(), published: false,
      source: `${base.results.length} real AthleticLIVE results from ${meetCount} meet${meetCount === 1 ? "" : "s"} in this league`,
      rulesVersion: this.global ? versionsAt(this.global, Number.POSITIVE_INFINITY).label : "league rules",
      seasonNote: note,
      contestsNote: contests.length ? `${contests.length} played matchups re-scored with each option (same lineups).` : "No fantasy matchups have been played on these results yet, so player totals are compared.",
      note: "Preview only. Nothing was changed: scoring rules, relay scoring and finished weeks are untouched.",
      ...out,
    };
  }

  private async runBacktestStored(): Promise<Record<string, unknown>> {
    const out = this.runBacktest();
    await this.ctx.storage.put("proj:accuracy", { at: Date.now(), modelVersion: MODEL_VERSION, withEntries: out.withEntries, headToHead: out.headToHead, samples: out.samples, meetsTested: out.meetsTested });
    return out;
  }

  private runBacktest(): Record<string, unknown> {
    const { base, note, meets } = this.labBase();
    if (meets < 2) return { ok: false, message: "Back-testing needs at least two real meets in this league." };
    const out = backtest(base, this.require().athletes.map((a) => ({ id: a.id, gender: a.gender })), 14);
    return { ok: true, at: Date.now(), modelVersion: MODEL_VERSION, seasonNote: note, ...out };
  }

  // MARK: - Schedule management

  /** First regular week that may still change: weeks already started, final or showing a final result never do. */
  private firstEditableWeek(): number {
    const s = this.require();
    if (s.phase === "predraft" || s.phase === "drafting") return 1;
    const w = s.week;
    const started = s.advanceAt != null
      || s.schedule.some((m) => m.week === w && m.final)
      || Object.keys(s.locks?.[String(w)] ?? {}).length > 0
      || s.meets.some((m) => !m.isDemo && !m.history && m.week === w && (m.status === "LIVE" || m.status === "FINAL"))
      || [...this.results.values()].some((r) => r.week === w && !r.historyOnly);
    return started ? w + 1 : w;
  }

  private scheduleView(seed: number | null): Record<string, unknown> {
    const s = this.require();
    const ids = s.teams.map((t) => t.id);
    const weeks = this.st().regularWeeks;
    const from = this.firstEditableWeek();
    const games = s.schedule as Game[];
    const preview = seed && s.schedule.length > 0 && from <= weeks ? regenerate(games, ids, weeks, from, seed) : null;
    const changed = preview ? preview.filter((g) => g.kind === "regular" && g.week >= from && !games.some((x) => x.week === g.week && x.homeId === g.homeId && x.awayId === g.awayId)).length : 0;
    return {
      teams: s.teams.map((t) => ({ id: t.id, name: t.teamName })), regularWeeks: weeks, playoffTeams: this.playoffTeamCount(), totalWeeks: this.totalWeeks(),
      currentWeek: s.week, firstEditableWeek: from, phase: s.phase, advanceAt: s.advanceAt ?? null, timezone: "America/New_York",
      rhythm: ["Monday 12:00 AM: the new week's matchup becomes active", "Wednesday 3:00 AM: waivers process", "Meet day: live scoring as verified results arrive", "When every meet of the week is final: matchup and standings are finalized; the final stays up until Monday"],
      schedule: s.schedule.map((m) => ({ ...m, locked: m.final || m.kind !== "regular" || m.week < from })),
      checks: checkSchedule(games, ids, weeks),
      preview: preview ? { seed, schedule: preview, checks: checkSchedule(preview, ids, weeks), changedGames: changed } : null,
      log: (s.scheduleLog ?? []).slice(-30).reverse(),
    };
  }

  private logSchedule(user: User, action: string, detail: string, fromWeek: number): void {
    const s = this.require();
    s.scheduleLog = [...(s.scheduleLog ?? []), { at: Date.now(), by: user.name, byId: user.id, action, detail, fromWeek }].slice(-60);
    this.audit(user, `schedule.${action}`, detail);
    this.tx("commish", null, `Commissioner ${action === "regenerate" ? "regenerated the schedule" : "edited the schedule"} from Week ${fromWeek}`);
    this.notify("Schedule updated", `The commissioner updated matchups from Week ${fromWeek}. Completed weeks are unchanged.`, "league", null, true, { key: `schedule:${Date.now()}`, link: { type: "matchup", week: fromWeek } });
  }

  /**
   * Commissioner-approved correction of an already-final regular week: re-freezes each matchup's score from the
   * current engine totals. Only runs when explicitly requested; every change is audited and both teams are told.
   */
  private correctFinalWeek(week: number, user: User, why: string): void {
    const s = this.require();
    if (week > this.st().regularWeeks) return;
    for (const m of s.schedule.filter((x) => x.week === week && x.final && x.kind === "regular")) {
      const h = this.teamWeekScore(m.homeId, week);
      const a = m.awayId ? this.teamWeekScore(m.awayId, week) : null;
      if (Math.abs(h - (m.homeFinal ?? 0)) < 0.001 && (a === null || Math.abs(a - (m.awayFinal ?? 0)) < 0.001)) continue;
      const before = `${m.homeFinal ?? 0}–${m.awayFinal ?? "bye"}`;
      m.homeFinal = h;
      m.awayFinal = a;
      this.audit(user, "matchup.correct", `Week ${week} ${this.team(m.homeId).teamName} vs ${m.awayId ? this.team(m.awayId).teamName : "BYE"}: ${before} → ${h}–${a ?? "bye"} (${why})`);
      this.notify(`Week ${week} final corrected`, `The commissioner applied a verified correction (${why}). Final: ${h}–${a ?? "bye"}.`, "score", [m.homeId, ...(m.awayId ? [m.awayId] : [])], true, { key: `correct:${week}:${m.id}:${h}:${a}`, link: { type: "matchup", week } });
    }
  }

  /** The completed week moves aside for the next one (Monday, or earlier if the next week's meet goes live). */
  private advanceWeek(): void {
    const s = this.require();
    if (s.advanceAt == null) return;
    s.advanceAt = null;
    s.week += 1;
    this.notify(`Week ${s.week} is live`, "Your new matchup is active. Set your lineup. Each player locks when their own event starts.", "score", null, false, { key: `week:${s.week}`, link: { type: "matchup", week: s.week } });
    // Its meets already finished while the previous result was on display: close it now (shows until next Monday).
    const meets = s.meets.filter((m) => !m.isDemo && !m.history && !m.archived && m.week === s.week);
    if (meets.length > 0 && this.openMeets(s.week).length === 0) this.finishWeek();
  }

  // MARK: - Waiver / free-agent rankings

  private async waiverRankings(requested: number): Promise<Record<string, unknown>> {
    const s = this.require();
    const owned = new Map<string, string>();
    for (const t of s.teams) for (const id of this.rosterOf(t)) owned.set(id, t.id);
    // A finished week has nothing left to project: rank on the next week that still has something to play.
    const week = this.targetWeek(requested);
    const allIds = s.athletes.map((a) => a.id).sort();
    const proj = this.projectFor(allIds, week);
    const outlook = this.outlookFor(allIds);
    const meets = s.meets.filter((m) => !m.isDemo && !m.history && !m.archived && m.week === week);
    const fields = Object.assign({}, ...meets.map((m) => m.fieldProfile ?? {})) as NonNullable<Meet["fieldProfile"]>;
    const pastWeeks = Array.from({ length: Math.max(0, week - 1) }, (_, i) => i + 1);
    const sd = (xs: number[]): number => {
      if (xs.length < 2) return 0;
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    };
    const rows = s.athletes.map((a) => {
      const p = proj[a.id];
      const weekly = pastWeeks.map((w) => ({ week: w, points: round2(this.pts[a.id]?.[String(w)] ?? 0), played: this.pts[a.id]?.[String(w)] !== undefined }));
      const played = weekly.filter((x) => x.played).map((x) => x.points);
      const avg = played.length ? round2(played.reduce((t, x) => t + x, 0) / played.length) : null;
      const last = played[played.length - 1] ?? null;
      const prior = played.slice(0, -1);
      const trend = last === null || prior.length === 0 ? null : round2(last - prior.reduce((t, x) => t + x, 0) / prior.length);
      const evs = (p?.events ?? []).filter((e) => e.status === "projected" || e.status === "live");
      const strengths = evs.map((e) => fields[`${a.gender}|${e.event}`]?.strength).filter((x): x is number => typeof x === "number");
      return {
        athleteId: a.id, availability: owned.has(a.id) ? "owned" : s.waivers[a.id] ? "waivers" : "freeAgent", ownerId: owned.get(a.id) ?? null,
        waiverUntil: s.waivers[a.id] ?? null, position: posCode(a), gender: a.gender,
        projected: p?.total ?? 0, projectedRemaining: p?.projected ?? 0, actualThisWeek: p?.actual ?? 0, sd: p?.sd ?? 0,
        confidence: p?.available ? p.confidence : null, projectionAvailable: p?.available ?? false,
        state: p?.state ?? "insufficient", stateLabel: p?.stateLabel ?? "Not enough data", upside: p?.upside ?? 0,
        outlookPerMeet: outlook[a.id]?.state === "projected" ? outlook[a.id]?.projected ?? null : null,
        events: evs.map((e) => e.event), recent: weekly.slice(-3), seasonAvg: avg, seasonTotal: round2(played.reduce((t, x) => t + x, 0)),
        lastWeek: last, trend, consistency: played.length >= 2 ? round2(sd(played)) : null, weeksPlayed: played.length,
        meetStrength: strengths.length ? round2(strengths.reduce((t, x) => t + x, 0) / strengths.length) : null,
        note: p?.note ?? "",
      };
    }).sort((x, y) => y.projected - x.projected || (y.outlookPerMeet ?? 0) - (x.outlookPerMeet ?? 0) || (y.seasonAvg ?? 0) - (x.seasonAvg ?? 0) || x.athleteId.localeCompare(y.athleteId));
    rows.forEach((r, i) => { (r as Record<string, unknown>).rank = i + 1; });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
    return {
      week, requestedWeek: requested, targetWeek: week, noMeet: this.weekMeets(week).length === 0 && this.meetsAhead(week),
      estimate: this.weekMeets(week).length === 0 && !this.meetsAhead(week), stateCounts: counts, modelVersion: MODEL_VERSION, computedAt: Date.now(), rows,
      accuracy: (await this.ctx.storage.get("proj:accuracy")) ?? null,
      note: "Rankings are recommendations only. They never change waiver priority or claim order. Actual points come only from verified results; projected points never count.",
    };
  }

  // MARK: - Projection explanations

  /** Plain-language "why it moved" from real evidence only: this week's projection vs last week's, plus new results. */
  private async explainProjection(athleteId: string, week: number): Promise<{ text: string; facts: string[]; source: "ai" | "rules"; note?: string }> {
    const a = this.athlete(athleteId);
    const now = this.projectFor([athleteId], week)[athleteId];
    const before = week > 1 ? this.projectFor([athleteId], week - 1)[athleteId] : undefined;
    const facts: string[] = [];
    if (!now || !now.available) facts.push("Not enough verified results to project yet.");
    else {
      facts.push(`Week ${week} projection: ${now.total.toFixed(2)} pts (${now.confidence ?? "Low"} confidence, ±${now.sd.toFixed(1)}).`);
      if (week > 1) facts.push(`Week ${week - 1} actual: ${round2(this.pts[athleteId]?.[String(week - 1)] ?? 0).toFixed(2)} pts.`);
      const recent = [...this.results.values()].filter((r) => r.athleteIds.includes(athleteId) && r.week === week - 1 && !r.historyOnly && !r.relay)
        .sort((x, y) => x.date.localeCompare(y.date));
      for (const r of recent.filter((x) => x.status !== "OK" || x.mark).slice(0, 4)) facts.push(`Week ${week - 1}: ${r.event} ${r.mark || r.status}${r.place ? `, ${ordinal(r.place)} overall` : ""} at ${r.meet}.`);
      for (const e of now.events.filter((x) => x.status === "projected").slice(0, 4)) {
        const old = before?.events.find((x) => x.event === e.event);
        facts.push(`${e.event}: this week's projected mark ${e.mark ?? ""} → ${e.ifCompetes.toFixed(1)} pts if entered (${Math.round(e.probability * 100)}% chance of entering)${old?.mark && old.mark !== e.mark ? `; last week's projected mark was ${old.mark}` : ""}.`);
      }
    }
    const rulesText = facts.join(" ");
    const key = `explain:${hash(JSON.stringify([MODEL_VERSION, athleteId, week, facts]))}`;
    const cached = await this.ctx.storage.get<string>(key);
    if (cached) return { text: cached, facts, source: "ai" };
    const secret = this.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY;
    if (!secret || !now?.available) return { text: rulesText, facts, source: "rules", note: secret ? "no projection" : "AI key not configured on the server" };
    try {
      const base = (this.env.EXPO_PUBLIC_TOOLKIT_URL || "https://toolkit.rork.com").replace(/\/$/, "");
      const res = await fetch(`${base}/v2/vercel/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic/claude-haiku-5.5", max_tokens: 900, temperature: 0.2, reasoning: { enabled: false },
          messages: [
            { role: "system", content: "You explain fantasy track & field projections in 1-2 short sentences for a high-school league. Use ONLY the facts given. Never invent marks, meets, numbers or reasons. Never comment on missing information. No hype." },
            { role: "user", content: `Athlete: ${a.name}. Facts: ${rulesText}\nExplain what drives this week's projection and, if last week's projected marks are listed, what changed.` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`AI ${res.status}`);
      const raw = await res.text();
      const data = JSON.parse(raw) as { choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[] };
      const content = data.choices?.[0]?.message?.content;
      const text = (typeof content === "string" ? content : (content ?? []).map((c) => c.text ?? "").join(" ")).trim().slice(0, 400);
      if (!text) throw new Error(`empty: ${raw.slice(0, 60)}`);
      await this.ctx.storage.put(key, text);
      return { text, facts, source: "ai" };
    } catch (e) {
      console.warn("projection explanation fell back to rules", String(e).slice(0, 120));
      return { text: rulesText, facts, source: "rules", note: String(e).slice(0, 80) };
    }
  }

  // MARK: - Projections

  private weekDate(week: number): string {
    const meets = this.require().meets.filter((m) => !m.isDemo && !m.history && !m.archived && m.week === week && m.date);
    return meets.map((m) => m.date).sort()[0] ?? new Date().toISOString().slice(0, 10);
  }

  /** Runs the projection model for a set of athletes in one week. Cached until results, lineups, entries or rules change. */
  private weekMeets(week: number): Meet[] {
    return this.require().meets.filter((m) => !m.isDemo && !m.history && !m.archived && m.week === week);
  }

  /** Every meet of the week is final (or the week's matchups are final / already in the past). */
  private weekIsDone(week: number): boolean {
    const s = this.require();
    const meets = this.weekMeets(week);
    const weekFinal = s.schedule.some((m) => m.week === week && m.final) || week < s.week;
    return weekFinal || (meets.length > 0 && meets.every((m) => m.status === "FINAL"));
  }

  /** Week the waiver / free-agent lists should project: the next week once the current one is over. */
  private targetWeek(week: number): number {
    const last = Math.max(1, this.totalWeeks() || this.st().regularWeeks);
    let w = week;
    while (w < last && this.weekIsDone(w)) w++;
    return w;
  }

  /** Season whose time/mark tables score hypothetical performances on a date (latest season with tables if none yet). */
  private tableSeasonFor(date: string): number {
    const want = seasonOf(date, this.require().season);
    const seasons = [...new Set([...this.scoring.performance, ...liveRows(this.global?.performance ?? [])].filter((p) => p.active).map((p) => p.season))];
    if (seasons.includes(want) || seasons.length === 0) return want;
    const older = seasons.filter((x) => x <= want);
    return older.length ? Math.max(...older) : Math.max(...seasons);
  }

  /** The rules projections use: a test league's sandbox rules when set, otherwise the league's real (global) rules. */
  private projBase(): ScoringInput {
    const own = [...this.results.values()];
    const base = this.scoringInput(own);
    const sh = this.isMain() ? null : this.sharedHistory;
    const lib = this.libraryCache?.results ?? [];
    if (!sh && lib.length === 0) return base;
    // Shared Main League history and this league's projection library join as history-only rows (deduped).
    const tag = (r: Result): string => `${r.athleteIds[0]}|${keyOf(r.event)}|${r.date}|${r.mark}`;
    const seen = new Set(own.map(tag));
    const extra: Result[] = [];
    for (const [pre, rows] of [["sh", sh?.results ?? []], ["lib", lib]] as const) {
      for (const r of rows) {
        if (!r.athleteIds[0] || !this.maybeAthlete(r.athleteIds[0]) || seen.has(tag(r))) continue;
        seen.add(tag(r));
        extra.push({ ...r, id: `${pre}:${r.id}`, key: `${pre}:${r.key}`, week: 0, historyOnly: true, meetId: null });
      }
    }
    const pbs: Record<string, Record<string, string>> = { ...(sh?.pbs ?? {}) };
    for (const [a, m] of Object.entries(base.pbs)) pbs[a] = { ...(sh?.pbs[a] ?? {}), ...m };
    return { ...base, results: [...extra, ...base.results], pbs };
  }

  /** Is any real meet scheduled this week or later? (None = preseason without a schedule, or the off-season.) */
  private meetsAhead(week: number): boolean {
    return this.require().meets.some((m) => !m.isDemo && !m.history && !m.archived && m.week >= week);
  }

  private projectFor(ids: string[], week: number): Record<string, Projection> {
    const s = this.require();
    const meets = this.weekMeets(week);
    const published = meets.filter((m) => Object.keys(m.entryEvents ?? {}).length > 0);
    // Every meet of the week published entries: an athlete missing from all of them is "not entered" (not guessed from history).
    const complete = meets.length > 0 && published.length === meets.length;
    const entries: Record<string, string[]> | null = published.length > 0
      ? Object.fromEntries(ids.filter((id) => complete || meets.some((m) => m.entryEvents?.[id])).map((id) => [id, [...new Set(meets.flatMap((m) => m.entryEvents?.[id] ?? []))]]))
      : null;
    const weekDone = this.weekIsDone(week);
    // No meet now or later: a typical-meet estimate instead of a bye. A gap before later meets stays a bye week.
    const estimate = meets.length === 0 && week >= s.week && !this.meetsAhead(week) && !(s.schedule.some((m) => m.week === week && m.final));
    const noMeet = meets.length === 0 && !estimate;
    const completed = new Set(meets.flatMap((m) => m.completedEvents ?? []));
    const fields = Object.assign({}, ...meets.map((m) => m.fieldProfile ?? {})) as NonNullable<Meet["fieldProfile"]>;
    const today = new Date().toISOString().slice(0, 10);
    const key = hash(JSON.stringify([MODEL_VERSION, this.sharedHistory?.hash ?? "", this.libraryCache?.hash ?? "", estimate ? today : "", this.linesHash, week, ids, entries, weekDone, noMeet, [...completed], hash(JSON.stringify(fields)), this.scoring.performance.length, hash(JSON.stringify(this.scoring.performance)), hash(JSON.stringify(this.scoring.standards)), hash(JSON.stringify(this.scoring.pbs)), this.global?.scoringVersion ?? 0, hash(JSON.stringify(s.sandboxRules ?? null))]));
    const cacheKey = `${week}|${ids.length === 1 ? ids[0] : "all"}`;
    const hit = this.projCache.get(cacheKey);
    if (hit && hit.key === key) return hit.data;
    const athletes = ids.map((id) => this.maybeAthlete(id)).filter((a): a is Athlete => !!a).map((a) => ({ id: a.id, gender: a.gender }));
    const date = estimate ? today : this.weekDate(week);
    const data = project({ base: this.projBase(), lines: this.lines, athletes, week, date, entries, weekDone: estimate ? false : weekDone, completedEvents: completed, fields, noMeet, estimate, season: this.tableSeasonFor(date) });
    this.projCache.set(cacheKey, { key, at: Date.now(), data });
    if (this.projCache.size > 60) this.projCache.delete(this.projCache.keys().next().value as string);
    return data;
  }

  /**
   * Season outlook: expected points PER MEET if the athlete races their usual events at a typical meet, from all
   * verified history and the current scoring rules. Ignores entries and finished weeks. Never a weekly PROJ number.
   */
  private outlookFor(ids: string[]): Record<string, Projection> {
    const s = this.require();
    const today = new Date().toISOString().slice(0, 10);
    const next = s.meets.filter((m) => !m.isDemo && !m.history && !m.archived && m.date && m.date >= today).map((m) => m.date).sort()[0] ?? today;
    const key = hash(JSON.stringify(["outlook", MODEL_VERSION, this.sharedHistory?.hash ?? "", this.linesHash, ids, next, this.global?.scoringVersion ?? 0, hash(JSON.stringify(this.scoring.performance)), hash(JSON.stringify(this.scoring.pbs)), hash(JSON.stringify(s.sandboxRules ?? null))]));
    const cacheKey = `outlook|${ids.length === 1 ? ids[0] : "all"}`;
    const hit = this.projCache.get(cacheKey);
    if (hit && hit.key === key) return hit.data;
    const athletes = ids.map((id) => this.maybeAthlete(id)).filter((a): a is Athlete => !!a).map((a) => ({ id: a.id, gender: a.gender }));
    // Week 999 = an open, not-yet-played week: every stored result is history, current rules apply, no actuals.
    const data = project({ base: this.projBase(), lines: [], athletes, week: 999, date: next, entries: null, weekDone: false, completedEvents: new Set(), season: this.tableSeasonFor(next) });
    this.projCache.set(cacheKey, { key, at: Date.now(), data });
    return data;
  }

  private athleteProjection(athleteId: string, week: number): unknown {
    this.athlete(athleteId);
    const p = this.projectFor([athleteId], week)[athleteId];
    const o = this.outlookFor([athleteId])[athleteId];
    const g = this.global;
    return {
      week, modelVersion: MODEL_VERSION, projection: p ?? null,
      outlook: o && o.state === "projected" ? { perMeet: o.projected, upside: o.upside, sd: o.sd, confidence: o.confidence, events: o.events.map((e) => ({ event: e.event, mark: e.mark, probability: e.probability, points: e.points, ifCompetes: e.ifCompetes })) } : null, stale: this.weekStale(week), computedAt: Date.now(), date: this.weekDate(week),
      versions: g ? versionsAt(g, Number.POSITIVE_INFINITY).label : "league rules", inputsHash: hash(JSON.stringify([MODEL_VERSION, this.linesHash, week, g?.scoringVersion ?? 0])),
      note: "Projected points never enter matchups, standings, scoring history or final results.",
    };
  }

  private weekStale(week: number): boolean {
    return this.require().meets.some((m) => !m.isDemo && m.week === week && m.status === "LIVE" && !!m.sourceError);
  }

  /** Projected totals (eligible starters only), spread and win chances for every matchup in a week. */
  private computeWeek(week: number): Record<string, unknown> {
    const s = this.require();
    const ids = new Set<string>();
    const lineups = new Map(s.teams.map((t) => [t.id, this.lineupFor(t.id, week)]));
    for (const l of lineups.values()) for (const slot of STARTERS) if (l[slot]) ids.add(l[slot] as string);
    const proj = this.projectFor([...ids].sort(), week);
    const teams: Record<string, { projected: number; actual: number; total: number; sd: number; starters: number }> = {};
    for (const t of s.teams) {
      const l = lineups.get(t.id) ?? emptyLineup();
      let projected = 0; let actual = 0; let v = 0; let n = 0;
      for (const slot of STARTERS) {
        const aid = l[slot];
        if (!aid) continue;
        n++;
        const p = proj[aid];
        // Actual team points always come from the engine; projections only fill what hasn't happened yet.
        actual += this.athleteWeek(aid, week);
        if (p) { projected += p.projected; v += p.sd ** 2; }
      }
      teams[t.id] = { projected: round2(projected), actual: round2(actual), total: round2(actual + projected), sd: round2(Math.sqrt(v)), starters: n };
    }
    const matchups = s.schedule.filter((m) => m.week === week).map((m) => {
      const home = teams[m.homeId] ?? { projected: 0, actual: 0, total: 0, sd: 0, starters: 0 };
      const away = m.awayId ? teams[m.awayId] ?? null : null;
      const win = away ? winProbability(home, away, m.final) : null;
      return { id: m.id, homeId: m.homeId, awayId: m.awayId, final: m.final, homeFinal: m.final ? this.matchScore(m, m.homeId) : null, awayFinal: m.final && m.awayId ? this.matchScore(m, m.awayId) : null, winHome: win?.home ?? null, winAway: win?.away ?? null };
    });
    return {
      week, modelVersion: MODEL_VERSION, computedAt: Date.now(), stale: this.weekStale(week), final: s.schedule.some((m) => m.week === week && m.final), athletes: proj, teams, matchups,
      versions: this.global ? versionsAt(this.global, Number.POSITIVE_INFINITY).label : "league rules",
    };
  }

  private async weekProjections(week: number): Promise<unknown> {
    const s = this.require();
    const out = this.computeWeek(week);
    if (s.phase === "season" && week === s.week) {
      const meets = s.meets.filter((m) => !m.isDemo && m.week === week);
      const phase = meets.some((m) => m.status === "LIVE" || m.status === "FINAL") ? "live" : "pre";
      await this.storeSnapshot(week, phase, out);
    }
    return out;
  }

  /** Keeps the before-meet snapshot as first taken, the latest live one, the final one, plus a capped history. */
  private async storeSnapshot(week: number, phase: "pre" | "live" | "final", data: Record<string, unknown>): Promise<void> {
    const key = `projsnap:${week}:${phase}`;
    const summary = { at: Date.now(), phase, modelVersion: MODEL_VERSION, teams: data.teams, matchups: data.matchups };
    if (phase === "pre" && (await this.ctx.storage.get(key))) return;
    const sig = hash(JSON.stringify([data.teams, data.matchups]));
    const histKey = `projhist:${week}`;
    const hist = (await this.ctx.storage.get<{ at: number; phase: string; sig: string; teams: unknown; matchups: unknown }[]>(histKey)) ?? [];
    if (hist[hist.length - 1]?.sig === sig) return;
    hist.push({ ...summary, sig });
    await this.ctx.storage.put({ [key]: summary, [histKey]: hist.slice(-60) });
  }

  private snapshotProjections(week: number, phase: "final"): void {
    try {
      const data = this.computeWeek(week);
      this.ctx.waitUntil(this.storeSnapshot(week, phase, data).catch((e: unknown) => console.warn("projection snapshot failed", String(e))));
    } catch (e) {
      console.warn("projection snapshot failed", String(e));
    }
  }

  /**
   * Validates a position assignment. Accepts a combined code ("SPR/DIS", "FLEX", …) or a positions array.
   * Unknown values are rejected (never silently turned into Flex or cut down to the first position).
   */
  private parsePos(pos: string, positions: string[]): { positions: Pos[]; flex: boolean } {
    const tokens = (pos ? pos.split(/[\/,+ ]+/) : positions).map((p) => p.trim().toUpperCase()).filter(Boolean);
    if (tokens.length === 0) throw new ActionError("Pick a position.");
    const bad = tokens.filter((p) => !["SPR", "DIS", "FLD", "FLEX"].includes(p));
    if (bad.length > 0) throw new ActionError(`Unknown position: ${bad.join(", ")}.`);
    if (tokens.includes("FLEX") || new Set(tokens).size === 3) {
      const flex = POSITION_CODES.FLEX as { positions: Pos[]; flex: boolean };
      return { positions: [...flex.positions], flex: true };
    }
    const code = (["SPR", "DIS", "FLD"] as Pos[]).filter((p) => tokens.includes(p)).join("/");
    const hit = POSITION_CODES[code];
    if (!hit) throw new ActionError("Pick a position.");
    return { positions: [...hit.positions], flex: hit.flex };
  }

  /** Commissioner-only headshot for one athlete in this league. Saved only once storage confirms; old photo removed after. */
  private async setAthletePhoto(user: User, athleteId: string, image: string, remove: boolean, expectAt: number | null | undefined): Promise<unknown> {
    this.assertCommish(user);
    const a = this.athlete(athleteId);
    const current = a.photoAt ?? null;
    if (expectAt !== undefined && (expectAt ?? null) !== current) {
      throw new ActionError(`${a.name}'s photo was just changed. Showing the latest.`);
    }
    const prevKey = current ? `aphoto:${a.id}:${current}` : null;
    if (remove) {
      if (!current) return this.view(user.id);
      delete a.photoAt;
      this.audit(user, "athlete.photo", `${a.name}: photo removed`);
      await this.save();
      if (prevKey) await this.ctx.storage.delete(prevKey);
      return this.view(user.id);
    }
    const b64 = image.replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
    if (b64.length < 200 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new ActionError("That photo couldn't be used. Try another image.");
    if (b64.length > MAX_PHOTO_B64) throw new ActionError("That photo is too large. Try again.");
    if (!b64.startsWith("/9j/")) throw new ActionError("Photos must be saved as JPEG.");
    const at = Math.max(Date.now(), (current ?? 0) + 1);
    await this.ctx.storage.put(`aphoto:${a.id}:${at}`, b64);
    a.photoAt = at;
    this.audit(user, "athlete.photo", `${a.name}: new headshot (${Math.round((b64.length * 3) / 4 / 1024)} KB)`);
    try {
      await this.save();
    } catch (e) {
      a.photoAt = current ?? undefined;
      if (a.photoAt === undefined) delete a.photoAt;
      await this.ctx.storage.delete(`aphoto:${a.id}:${at}`);
      throw e;
    }
    if (prevKey) await this.ctx.storage.delete(prevKey);
    return this.view(user.id);
  }

  /** Replaces one Fantasy T&F performance table. Finished weeks keep the tiers they were scored with. */
  private setPerformanceTable(user: User, action: Record<string, unknown>): string {
    const s = this.require();
    const event = String(action.event ?? "").trim();
    const hit = PERFORMANCE_EVENTS.find((e) => keyOf(e) === keyOf(event));
    if (!hit) throw new ActionError("Performance tables are for individual track and field events.");
    const measurement = measurementTypeOf(hit);
    if (!measurement) throw new ActionError("That event can't have a performance table.");
    const g = String(action.gender ?? "");
    const gender: Gender | "X" = g === "B" || g === "G" ? g : "X";
    const season = clampInt(action.season, 2000, 2100, s.season);
    const raw = Array.isArray(action.tiers) ? (action.tiers as Record<string, unknown>[]) : [];
    if (raw.length > 12) throw new ActionError("Use at most 12 tiers per table.");
    const now = Date.now();
    const done = this.lastCompletedWeek();
    const tiers: PerformanceRule[] = [];
    for (const t of raw) {
      const mark = String(t.mark ?? "").trim().slice(0, 16);
      const { m, issue } = measureForEvent(mark, hit);
      if (!m) throw new ActionError(`${hit}: ${issue ?? "unreadable mark"}.`);
      const points = Number(t.points);
      if (!Number.isFinite(points) || points <= 0 || points > 50) throw new ActionError(`${hit} ${mark}: points must be between 0.5 and 50.`);
      if (tiers.some((x) => Math.abs(x.value - m.value) < 1e-6)) throw new ActionError(`${hit}: ${mark} is listed twice.`);
      tiers.push({
        id: `${gender}-${keyOf(hit)}-${season}-${Math.round(m.value * 10000)}-${now}`, season, gender, event: hit, measurement, mark,
        value: Math.round(m.value * 1_000_000) / 1_000_000, points: Math.round(points * 2) / 2, active: t.active !== false, updatedAt: now,
        fromWeek: done + 1, toWeek: null,
      });
    }
    // Better marks must never be worth fewer points (time: faster = better; distance/height: farther/higher = better).
    const ordered = [...tiers].sort((x, y) => (measurement === "TIME" ? x.value - y.value : y.value - x.value));
    for (let i = 1; i < ordered.length; i++) {
      if ((ordered[i] as PerformanceRule).points > (ordered[i - 1] as PerformanceRule).points) {
        throw new ActionError(`${hit}: ${(ordered[i] as PerformanceRule).mark} can't be worth more than the better mark ${(ordered[i - 1] as PerformanceRule).mark}.`);
      }
    }
    const same = (p: PerformanceRule): boolean => p.season === season && p.gender === gender && keyOf(p.event) === keyOf(hit);
    const kept: PerformanceRule[] = [];
    for (const p of this.scoring.performance) {
      if (!same(p)) { kept.push(p); continue; }
      if (p.toWeek !== undefined && p.toWeek !== null) { kept.push(p); continue; }
      // Rows that already scored finished weeks are closed off, not deleted.
      if ((p.fromWeek ?? 1) <= done) kept.push({ ...p, toWeek: done });
    }
    this.scoring.performance = [...kept, ...tiers];
    const label = `${gender === "X" ? "All" : gender === "G" ? "Girls" : "Boys"} ${hit} ${season}`;
    this.audit(user, "performance.table", `${label}: ${ordered.length === 0 ? "cleared" : ordered.map((t) => `${t.mark}=+${t.points}`).join(", ")}${done > 0 ? ` (from week ${done + 1})` : ""}`);
    return label;
  }
}
