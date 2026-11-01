/** Types for the commissioner integrity tools and weekly proofs. Every number comes from the server's scoring engine. */
export type BLine = { code: string; category?: string; label: string; points: number; basis?: string; ver?: string; season?: number | null };
export type BEvent = {
  resultId: string; sourceResultId: string | null; eventId: string | null; meet: string; date: string; event: string; relay: boolean; relayTeam: string | null;
  round: string | null; heat: number | null; place: number | null; heatPlace: number | null; fieldSize: number | null;
  mark: { original: string; value: number | null; unit: string; method: string }; status: string; pbsb: string; seedMark: string | null;
  provisional: boolean; season: number | null; corrections: { at: number; mark: string; place: number | null; heatPlace: number | null; status: string }[];
  lines: BLine[]; total: number;
};
export type Check = { ok: boolean; text: string };
export type WeekBreakdown = {
  athleteId: string; name: string; week: number; events: BEvent[]; eventCount: number; sumOfEvents: number; weeklyTotal: number; check: Check;
  starter: { teamId: string; teamName: string; slot: string | null } | null; matchupContribution: number;
};
export type TeamRow = { slot: string; athleteId: string | null; name: string | null; total: number; events: { event: string; meet: string; total: number }[] };
export type TeamBreakdown = { teamId: string; teamName: string; week: number; starters: TeamRow[]; bench: TeamRow[]; matchupScore: number; final: boolean; check: Check };

export type ReconcileReport = {
  at: number; ok: boolean; mismatches: number; verdict: string; planted: { removedResult: string | null; duplicatedLine: string | null } | null;
  counts: Record<string, number>; meets: { meetId: string; name: string; reread: boolean; sourceRows?: number; expected?: number; stored?: number; missing?: number; orphaned?: number; stale?: number }[];
  issues: { kind: string; severity: string; detail: string }[];
};
export type HealthReport = {
  athletes: Record<string, number | string[]> & { duplicateExamples: string[] };
  meets: { id: string; name: string; week: number; status: string; live: boolean; sourceStatus: string; freshnessMin: number | null; events: number; results: number; scored: number; history: boolean; rehearsal: boolean }[];
  scoring: Record<string, number | string | null>; notifications: Record<string, number>; projections: Record<string, number | string | boolean | null>;
};
export type NoteLog = { deliveryKey: string; title: string; category: string; recipients: number; createdAt: number; attempts: number; status: string; error: string | null; link: string };
export type Snapshot = { at: number; reason: string; results: number; points: number };
export type Versions = {
  current: { scoring: number; tables: number; label: string } | null; rules: { version: number; since: number; by: string | null }[];
  tables: { at: number; version: number; by: string; detail: string }[]; audit: { at: number; actorName: string; action: string; detail: string }[];
};
export type ChangePreview = {
  ok: boolean; problems: string[]; diff: { key: string; currentText: string; nextText: string }[];
  table: { event: string; gender: string; season: number; current: { mark: string; points: number }[]; next: { mark: string; points: number }[] } | null;
  source: string; athletesAffected: number; finishedWeeksProtected: number[];
  example: { name: string; week: number; oldScore: number; newScore: number } | null; currentVersion: { scoring: number; tables: number; label: string }; canPublish?: boolean;
};
export type PerfRow = { id: string; season: number; gender: string; event: string; measurement: string; mark: string; value: number; points: number; until?: number | null; ver?: number };

export const CATEGORIES: [string, string][] = [
  ["part", "Per-event participation"], ["place", "Overall / relay place"], ["heat", "Heat / flight place"], ["pct", "Seeded / unseeded percentile"],
  ["perf", "Time / mark tables"], ["best", "PB / SB (never stacked)"], ["std", "Standards"], ["dq", "DQ / DNF"], ["sr", "School record"], ["fumble", "Baton fumble"],
];
export const APPLIES: [string, string][] = [["individual", "Individual"], ["relay", "Relay"], ["track", "Track"], ["field", "Field"]];
export const signed = (n: number): string => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 1)}`;
