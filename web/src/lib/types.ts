export type SlotId = "SPR" | "DIS" | "FLD" | "FLEX" | "BN1" | "BN2" | "IR";
export const SLOTS: SlotId[] = ["SPR", "DIS", "FLD", "FLEX", "BN1", "BN2", "IR"];
export const STARTERS: SlotId[] = ["SPR", "DIS", "FLD", "FLEX"];
export const SLOT_LABEL: Record<SlotId, string> = { SPR: "SPR", DIS: "DIS", FLD: "FLD", FLEX: "FLEX", BN1: "BN", BN2: "BN", IR: "IR" };

export type Athlete = {
  id: string; name: string; gender: "B" | "G"; positions: string[]; flex: boolean; note: string; rank: number;
  school?: string; status?: "active" | "Q" | "O" | "IR"; position: string; photo: string | null;
};

export type Team = {
  id: string; ownerName: string; teamName: string; color: string; avatarAt: number | null;
  coManagerId: string | null; coManagerName: string | null; coInvite: { code: string; at: number } | null;
  lineup: Record<SlotId, string | null>; roster: string[]; queue: string[];
  waiverPriority: number; faab: number; addsThisWeek: number; joinedAt: number;
  wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; streak: string; rank: number;
};

export type Matchup = {
  id: string; week: number; homeId: string; awayId: string | null; final: boolean; kind: "regular" | "playoff" | "consolation";
  round: string | null; homeScore: number; awayScore: number | null;
};

export type Pick = { overall: number; round: number; pickInRound: number; teamId: string; athleteId: string; auto: boolean; at: number };

export type Meet = {
  id: string; name: string; date: string; week: number; provider: string; status: "UPCOMING" | "LIVE" | "FINAL";
  eventsUrl: string; rosterUrl: string; resultsUrl: string; isDemo?: boolean; polling: boolean; createdAt: number;
  sourceMeetId?: string | null; sourceInfo?: { name: string; date: string; location: string; timer: string; url: string } | null;
  lastSyncedAt: number | null; syncCount: number; sourceError: string | null; failures: number;
  stats: { processed: number; events: number; matched: number; relevant: number; unmatched: number; scored: number };
  sourceUrl?: string; resolve?: { ok: boolean; kind: string; message: string; at: number } | null;
  scope?: "global" | "local"; archived?: boolean; tablesMissing?: string[];
  lastTest?: { at: number; ok: boolean; message: string; results: number; matched: number } | null;
};

export type Trade = {
  id: string; fromId: string; toId: string; give: string[]; get: string[]; message: string; status: string;
  createdAt: number; resolvedAt: number | null; reviewUntil: number | null; vetoes: string[];
};

export type Claim = { id: string; teamId: string; addId: string; dropId: string | null; bid: number; status: string; createdAt: number; reason: string; rank?: number; resolvedAt?: number | null };
export type Tx = { id: string; kind: string; teamId: string | null; text: string; at: number; athleteIds: string[]; otherId?: string | null; status?: string; mine?: boolean };
export type Note = { id: string; at: number; title: string; body: string; kind: string; category: string; read: boolean };
export type Lock = { at: number; event: string; meetId: string; teamId: string | null; slot: SlotId | null; reason: string };

export type ScoringRules = {
  participation: number; overall: number[]; relay: number[]; pb: number; sb: number; bestMode: "single";
  heat: number[]; percentile: { pct: number; pts: number }[]; percentileUnseeded?: { pct: number; pts: number }[]; standardCap: number; schoolRecord: number; fumble: number; dqdnf: number;
};

export type GameSettings = {
  pickSeconds: number; regularWeeks: number; playoffTeams: number; consolation: boolean; tiebreaker: string;
  waiverType: string; waiverSchedule?: "weekly" | "daily"; waiverDay?: number; waiverDays: number; waiverHour: number; tzOffsetMin: number; faabBudget: number; maxAddsPerWeek: number;
  tradeReview: string; tradeReviewDays: number; vetoVotes: number; tradeDeadlineWeek: number; lineupLock: string;
};

export type Settings = GameSettings & { maxTeams: number; draftAt: number | null; draftOrderMode: string };

export type GlobalSetup = {
  version: number; scoringVersion: number; updatedAt: number; updatedBy: string; rules: ScoringRules; settings: GameSettings;
  roster: { irSlot: boolean; irStatuses: string[]; flexPositions: string[] };
  live: { pollSeconds: number; autoFinalMinutes: number; maxLiveHours: number };
  notices: Record<"player" | "trades" | "waivers" | "draft" | "live" | "league", boolean>;
};

export type Unmatched = {
  id: string; meetId: string; kind: "athlete" | "event" | "relay" | "mark"; sourceName: string; school: string; gender: string;
  /* meetId links the item to its meet (used to tell whether that week is already final). */
  eventName: string; result: string; candidates: string[]; relevant: boolean;
};

export type Bracket = {
  size: number; teams: number; seeded: boolean; seeds: string[]; championId: string | null;
  rounds: { week: number; name: string; games: { id: string; top: string | null; bottom: string | null; topSeed: number | null; bottomSeed: number | null; winnerId: string | null }[] }[];
};

export type LeagueState = {
  id: string; name: string; code: string; commissionerId: string; season: number; phase: "predraft" | "drafting" | "season" | "complete";
  settings: Settings; week: number; version: number; viewerId: string; role: "primary" | "co";
  locks: Record<string, Lock>; teams: Team[]; standings: string[]; athletes: Athlete[];
  draft: { order: string[]; picks: Pick[]; status: string; deadline: number | null; rounds: number };
  schedule: Matchup[]; bracket: Bracket | null; points: Record<string, Record<string, number>>;
  waivers: Record<string, number>; claims: Claim[]; trades: Trade[]; transactions: Tx[]; notifications: Note[];
  rankings: string[]; lastCompletedWeek: number; totalWeeks: number; me: string; serverNow: number;
  meets: Meet[]; adp: string[]; unmatched: Unmatched[]; unmatchedCount: number;
  isMainLeague: boolean; mainLeagueCode: string; canEditGlobal: boolean; shapePending: boolean; global: GlobalSetup | null; globalVersion: number;
  nextWaiverRun?: number; canEditPlayers?: boolean; waiverPriorityOrder?: string[];
  /** The finished week stays up until this time (next Monday 12:00 AM ET), then the next matchup activates. */
  nextWeekAt?: number | null;
  /** athleteId → open "possible match" results waiting for commissioner review (the "?" indicator). */
  reviewFlags?: Record<string, number>;
};

export type RankRow = {
  athleteId: string; rank?: number; availability: "owned" | "waivers" | "freeAgent"; ownerId: string | null; waiverUntil: number | null;
  position: string; gender: string; projected: number; projectedRemaining: number; actualThisWeek: number; sd: number;
  confidence: string | null; projectionAvailable: boolean; events: string[];
  /** projected · actual · finished · notEntered · noMeet · insufficient */
  state?: string; stateLabel?: string; upside?: number; outlookPerMeet?: number | null; recent: { week: number; points: number; played: boolean }[];
  seasonAvg: number | null; seasonTotal: number; lastWeek: number | null; trend: number | null; consistency: number | null; weeksPlayed: number;
  meetStrength: number | null; note: string;
};
export type RankingsBody = { week: number; targetWeek?: number; noMeet?: boolean; modelVersion: string; computedAt: number; rows: RankRow[]; note: string; accuracy: { withEntries?: { mae: number; coverage: number }; headToHead?: { accuracy: number | null }; samples?: number } | null };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** e.g. "Wednesday at 3:00 AM ET". */
export function waiverScheduleLabel(s: { waiverSchedule?: GameSettings["waiverSchedule"]; waiverDay?: number; waiverHour: number; waiverDays: number }): string {
  const h = s.waiverHour % 12 === 0 ? 12 : s.waiverHour % 12;
  const time = `${h}:00 ${s.waiverHour < 12 ? "AM" : "PM"} ET`;
  if (s.waiverSchedule === "daily") return `${s.waiverDays} day${s.waiverDays === 1 ? "" : "s"}, then ${time}`;
  return `${WEEKDAYS[s.waiverDay ?? 3]} at ${time}`;
}

export type LeagueSummary = { leagueId: string; code: string; name: string; hidden: boolean; isMainLeague?: boolean };

export type Projection = { athleteId: string; available: boolean; confidence: string | null; projected: number; actual: number; total: number; sd: number; note: string };
export type WeekProjections = {
  week: number; stale: boolean; final: boolean; athletes: Record<string, Projection>;
  teams: Record<string, { projected: number; actual: number; total: number; sd: number }>;
  matchups: { id: string; homeId: string; awayId: string | null; winHome: number | null; winAway: number | null }[];
};

export type ScoreLine = { id: string; athleteId: string; week: number; meet: string; event: string; code: string; label: string; points: number; detail: string; provisional: boolean };

export type MockSeat = { id: string; userId: string | null; name: string; bot: boolean; slot?: number | null };
export type MockDraft = {
  id: string; kind: "solo" | "league"; ownerId: string; ownerName: string; status: "lobby" | "live" | "done"; seats: MockSeat[];
  order: string[]; picks: { overall: number; round: number; pickInRound: number; seatId: string; athleteId: string; auto: boolean }[];
  lineups: Record<string, Record<SlotId, string | null>>; pickSeconds: number; deadline: number | null; version: number; rounds: number;
  onClock: string | null; mySeat: string | null;
};
export type MockBody = {
  mocks: { id: string; kind: string; ownerName: string; status: string; seats: number; joined: number; picks: number; mine: boolean; createdAt: number }[];
  mock: MockDraft | null; serverNow: number;
};

export const fmtPts = (n: number | null | undefined): string => (n ?? 0).toFixed(2);
export const record = (t: Team): string => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
export const weekLabel = (l: LeagueState, w: number): string => {
  if (w <= l.settings.regularWeeks) return `Week ${w}`;
  const r = l.bracket?.rounds.find((x) => x.week === w);
  return r?.name ?? `Week ${w}`;
};
export const timeAgo = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
export const onClockTeam = (order: string[], picks: number): string | null => {
  const n = order.length;
  if (n === 0) return null;
  const round = Math.floor(picks / n);
  const idx = picks % n;
  return (round % 2 === 0 ? order[idx] : order[n - 1 - idx]) ?? null;
};

/** Commissioner Admin Panel. The server decides access on every request. */
export type AdminAccess = { allowed: boolean; mode: "global" | "sandbox" | null; reason: string; isMainLeague: boolean; leagueName: string; limits: string };
export type AdminRulesRef = { rules: ScoringRules; version: number; label: string };
export type AdminDraftBody = { ok: boolean; mode: string; draft: { rules: ScoringRules; at: number; by: string; baseVersion: number } | null; current: AdminRulesRef };
export type AdminResult = { ok: boolean; message?: string; version?: number; duplicate?: boolean; finishedWeeksUnchanged?: boolean; finishedWeeks?: number };
export type AdminPreview = {
  ok: boolean; problems?: string[]; diff: { key: string; currentText: string; nextText: string }[]; athletesAffected: number;
  example: { name: string; week: number; oldScore: number; newScore: number } | null; finishedWeeksProtected: number[]; note?: string; unchanged?: boolean; finishedWeekChanges?: number;
};
export type AdminVersionRow = { version: number; since: number; by: string | null; note?: string; rules: ScoringRules };
export type AdminVersions = { ok: boolean; mode: string; global: AdminVersionRow[]; sandbox: AdminVersionRow[]; current: AdminRulesRef };
export type AdminChangelog = { ok: boolean; entries: { at: number; by: string; kind: string; text: string; scope: string }[] };
export type ProjZero = {
  athleteId: string; name: string; team: string | null; state: string; label: string; reason: string; actual: number;
  resultsOnFile: number; lastResult: string | null; pbsOnFile: number; outlookPerMeet: number | null; diagnosis: string;
};
export type ProjHealthBody = {
  ok: boolean; modelVersion: string; currentWeek: number; targetWeek: number; athletes: number; currentWeekStates: Record<string, number>;
  targetWeekStates: Record<string, number>; outlookAvailable: number; zeros: ProjZero[]; message?: string; rules: string;
};
export type DataValidation = {
  ok: boolean; results: number; duplicateKeys: number; needsReview: { athletes: number; marks: number; total: number }; athleteLinks: number; linkConflicts: number; note: string;
  meets: { id: string; name: string; date: string; week: number; status: string; rehearsal: boolean; results: number; scored: number; entries: number; ok: boolean; problems: string[] }[];
};

export const PROJ_STATE_LABEL: Record<string, string> = {
  projected: "Projected", actual: "Actual", finished: "Week finished", notEntered: "Not entered", noMeet: "No meet scheduled", insufficient: "Not enough data",
};
export const PROJ_STATE_SHORT: Record<string, string> = { finished: "FINAL", notEntered: "NOT ENT", noMeet: "NO MEET", insufficient: "NO DATA" };

/** Projection meets (commissioner tool). Projections only: never scoring, PBs or SBs. */
export type ProjMeetStat = { at: number; results: number; athletes: number; error?: string | null; kept?: boolean };
export type ProjMeetRow = { id: string; kind: "ATHLETICLIVE" | "TEXT"; name: string; date: string; url?: string; builtin?: boolean; by?: string; stat: ProjMeetStat | null };
export type ProjMeetsBody = {
  ok: boolean; mode: "global" | "sandbox"; shared: boolean; scopeNote: string; meets: ProjMeetRow[]; builtAt: number | null;
  totals: { meets: number; results: number; athletes: number }; message?: string; duplicate?: boolean;
};
export type ProjMeetPreviewBody = {
  ok: boolean; preview: ProjMeetRow; exists: boolean; rows: number; events: number; poolRows?: number; results: number; athletes: number; skipped: number;
  sample: { id: string; name: string; marks: string[] }[]; message: string;
};
