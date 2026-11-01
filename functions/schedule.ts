/**
 * Stage 2: league-scheduled meets. Pure helpers shared by league-run meets (league.ts) and the Main League's shared
 * meets (directory.ts), so both follow exactly the same rules:
 *
 *  - A meet has an official start and end in its own local time zone (daylight saving handled by the IANA zone).
 *  - Rosters lock at the official start.
 *  - After the end, the meet is PENDING finalization for at least 24 hours, and longer while results look incomplete.
 *  - Postpone / reschedule / cancel / interrupt / resume never move the meet to another matchup (its week is kept),
 *    and every change is logged on the meet.
 *
 * Meets without a start time (everything created before Stage 2) keep their original behavior.
 */
import type { Meet } from "./meets";

export const PENDING_HOLD_MS = 24 * 3_600_000;
export type MeetStage = "SCHEDULED" | "LIVE" | "PENDING" | "FINAL" | "POSTPONED" | "CANCELED" | "INTERRUPTED";
export type LifecycleOp = "postpone" | "reschedule" | "cancel" | "interrupt" | "resume";

export function validTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds the zone is ahead of UTC at instant `t` (negative for the Americas). */
export function zoneOffsetMs(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (k: string): number => Number(parts.find((p) => p.type === k)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/**
 * "2026-03-08T09:00" in `tz` → UTC ms. Two passes so the offset on the target day (not today) is used, which is
 * what makes a 9:00 AM start stay 9:00 AM on both sides of a daylight-saving change. A wall time that doesn't exist
 * (the skipped spring-forward hour) resolves to the same clock time an hour later.
 */
export function zonedToUtc(local: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m || !validTimeZone(tz)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  let t = wall - zoneOffsetMs(wall, tz);
  t = wall - zoneOffsetMs(t, tz);
  return t;
}

/** UTC ms → "YYYY-MM-DDTHH:mm" wall time in `tz`. */
export function utcToZoned(t: number, tz: string): string {
  return new Date(t + zoneOffsetMs(t, tz)).toISOString().slice(0, 16);
}

/** True when the meet runs on the Stage 2 schedule (has an official start). */
export function isScheduled(m: Meet): boolean {
  return typeof m.startAt === "number" && Number.isFinite(m.startAt);
}

/** When a pending meet may become FINAL (null when it isn't pending or isn't scheduled). */
export function finalEligibleAt(m: Meet): number | null {
  if (!isScheduled(m) || m.pendingSince == null) return null;
  return Math.max(m.pendingSince, m.endAt ?? m.pendingSince) + PENDING_HOLD_MS;
}

/** The status players see. `status` stays UPCOMING/LIVE/FINAL underneath so older app builds keep working. */
export function meetStage(m: Meet, now: number): MeetStage {
  if (m.lifecycle === "CANCELED") return "CANCELED";
  if (m.status === "FINAL") return "FINAL";
  if (m.lifecycle === "POSTPONED") return "POSTPONED";
  if (m.lifecycle === "INTERRUPTED") return "INTERRUPTED";
  if (m.pendingSince != null || m.correcting) return "PENDING";
  if (m.status === "LIVE") return "LIVE";
  if (isScheduled(m) && (m.startAt as number) <= now) return "LIVE";
  return "SCHEDULED";
}

/** Rosters for this meet's matchup are locked (official start passed, meet not postponed or canceled). */
export function rosterLocked(m: Meet, now: number): boolean {
  if (!isScheduled(m) || m.history || m.isDemo || m.archived) return false;
  if (m.lifecycle === "POSTPONED" || m.lifecycle === "CANCELED") return false;
  return (m.startAt as number) <= now;
}

/** Holds the meet's week open (a canceled meet doesn't; a postponed one does until it's played or canceled). */
export function holdsWeekOpen(m: Meet): boolean {
  return m.status !== "FINAL" && m.lifecycle !== "CANCELED";
}

export function logChange(m: Meet, by: string, kind: string, detail: string, now: number): void {
  m.changes = [...(m.changes ?? []), { at: now, by: by.slice(0, 60), kind, detail: detail.slice(0, 300) }].slice(-40);
}

const fmtLocal = (local: string | undefined, tz: string | undefined): string => (local ? `${local.replace("T", " ")}${tz ? ` ${tz}` : ""}` : "no time");

/**
 * Applies schedule fields from an Add/Edit Meet request. Returns a user-facing error, or null.
 * Accepts `startLocal`/`endLocal` ("YYYY-MM-DDTHH:mm") + `timeZone` (IANA) and `location`. `clearSchedule: true`
 * turns a meet back into an unscheduled one (only before it starts).
 */
export function applySchedule(m: Meet, a: Record<string, unknown>, now: number): string | null {
  const has = (k: string): boolean => a[k] !== undefined;
  const str = (k: string): string => String(a[k] ?? "").trim();
  if (has("location")) m.location = str("location").slice(0, 80);
  if (a.clearSchedule === true) {
    if (isScheduled(m) && (m.startAt as number) <= now) return "This meet already started; its start time can't be removed.";
    m.startAt = null; m.endAt = null; m.startLocal = undefined; m.endLocal = undefined;
    return null;
  }
  if (!has("startLocal") && !has("endLocal") && !has("timeZone")) return null;
  const tz = has("timeZone") ? str("timeZone") : m.timeZone ?? "";
  if (!validTimeZone(tz)) return "Pick the meet's time zone.";
  const startLocal = has("startLocal") ? str("startLocal") : m.startLocal ?? "";
  const endLocal = has("endLocal") ? str("endLocal") : m.endLocal ?? "";
  const start = zonedToUtc(startLocal, tz);
  if (start === null) return "Enter the meet's start date and time.";
  const end = endLocal ? zonedToUtc(endLocal, tz) : null;
  if (endLocal && end === null) return "Enter the meet's end date and time.";
  if (end !== null && end <= start) return "The meet has to end after it starts.";
  if (end !== null && end - start > 7 * 86_400_000) return "A meet can span at most 7 days.";
  const changedStart = m.startAt !== start;
  // Moving a meet's start after it began is a reschedule (logged), not an edit.
  if (isScheduled(m) && changedStart && (m.startAt as number) <= now && m.lifecycle !== "POSTPONED" && a.allowStarted !== true) {
    return "This meet already started. Use Reschedule to change its time.";
  }
  m.timeZone = tz;
  m.startLocal = startLocal;
  m.endLocal = end !== null ? endLocal : undefined;
  m.startAt = start;
  // No end given: the meet ends the same day (start + 12 hours) so the 24-hour hold always has an anchor.
  m.endAt = end ?? start + 12 * 3_600_000;
  m.date = startLocal.slice(0, 10);
  return null;
}

export type LifecycleResult = { error: string | null; detail: string; clearLocks: boolean; closeWeek: boolean; resumePolling: boolean };

/** Postpone / reschedule / cancel / interrupt / resume. Never changes the meet's week (its matchup). */
export function applyLifecycle(m: Meet, op: string, a: Record<string, unknown>, by: string, now: number): LifecycleResult {
  const fail = (error: string): LifecycleResult => ({ error, detail: "", clearLocks: false, closeWeek: false, resumePolling: false });
  const reason = String(a.reason ?? "").trim().slice(0, 200);
  const why = reason ? ` — ${reason}` : "";
  if (m.status === "FINAL") return fail(`${m.name} is final. Use Reopen for a correction.`);
  if (m.lifecycle === "CANCELED" && op !== "reschedule") return fail(`${m.name} was canceled. Reschedule it to bring it back.`);
  switch (op) {
    case "postpone": {
      if (m.lifecycle === "POSTPONED") return fail(`${m.name} is already postponed.`);
      const started = isScheduled(m) && (m.startAt as number) <= now;
      m.lifecycle = "POSTPONED";
      m.polling = false; m.nextSyncAt = null; m.pendingSince = null;
      const detail = `Postponed (was ${fmtLocal(m.startLocal, m.timeZone)})${why}`;
      logChange(m, by, "postpone", detail, now);
      return { error: null, detail, clearLocks: !started || (m.syncCount === 0), closeWeek: false, resumePolling: false };
    }
    case "reschedule": {
      const before = fmtLocal(m.startLocal, m.timeZone);
      const err = applySchedule(m, { ...a, allowStarted: true }, now);
      if (err) return fail(err);
      if (!isScheduled(m)) return fail("Enter the new start date and time.");
      m.lifecycle = null; m.pendingSince = null; m.holdNotified = null;
      const detail = `Rescheduled from ${before} to ${fmtLocal(m.startLocal, m.timeZone)}${why}`;
      logChange(m, by, "reschedule", detail, now);
      return { error: null, detail, clearLocks: (m.startAt as number) > now, closeWeek: false, resumePolling: false };
    }
    case "cancel": {
      m.lifecycle = "CANCELED";
      m.polling = false; m.nextSyncAt = null; m.pendingSince = null;
      const detail = `Canceled${why}`;
      logChange(m, by, "cancel", detail, now);
      return { error: null, detail, clearLocks: m.syncCount === 0, closeWeek: true, resumePolling: false };
    }
    case "interrupt": {
      if (m.lifecycle === "INTERRUPTED") return fail(`${m.name} is already interrupted.`);
      if (m.status !== "LIVE" && !(isScheduled(m) && (m.startAt as number) <= now)) return fail("Only a meet that has started can be interrupted. Postpone it instead.");
      m.lifecycle = "INTERRUPTED";
      m.polling = false; m.nextSyncAt = null;
      const detail = `Interrupted (results so far kept)${why}`;
      logChange(m, by, "interrupt", detail, now);
      return { error: null, detail, clearLocks: false, closeWeek: false, resumePolling: false };
    }
    case "resume": {
      if (m.lifecycle !== "INTERRUPTED") return fail(`${m.name} isn't interrupted.`);
      m.lifecycle = null;
      const detail = `Resumed${why}`;
      logChange(m, by, "resume", detail, now);
      return { error: null, detail, clearLocks: false, closeWeek: false, resumePolling: m.status === "LIVE" };
    }
    default:
      return fail("Unknown schedule change.");
  }
}

/**
 * What the alarm should do with a scheduled meet right now:
 *  "pending"   – the official end passed: enter Pending finalization.
 *  "final"     – held at least 24 hours and every event is complete: finalize.
 *  "incomplete"– held 24 hours but results look incomplete: keep holding (tell the commissioner once).
 */
export function scheduleTick(m: Meet, now: number): "pending" | "final" | "incomplete" | null {
  if (!isScheduled(m) || m.history || m.isDemo || m.archived || m.status === "FINAL" || m.lifecycle || m.correcting) return null;
  if (m.pendingSince == null) return m.endAt != null && m.endAt <= now ? "pending" : null;
  const at = finalEligibleAt(m);
  if (at === null || at > now) return null;
  return m.complete === true ? "final" : "incomplete";
}

/**
 * Checks a commissioner's "Mark Final" on a scheduled meet. Returns "pending" when the meet should enter the hold
 * instead, an error message when it can't be finalized yet, or null when finalizing now is allowed.
 */
export function finalGate(m: Meet, a: Record<string, unknown>, now: number): { pending?: true; error?: string; forced?: boolean } {
  if (!isScheduled(m)) return {};
  if (m.lifecycle === "CANCELED") return { error: `${m.name} was canceled.` };
  if (m.lifecycle === "POSTPONED") return { error: `${m.name} is postponed. Reschedule it first.` };
  // Finishing a correction on a meet that already served its hold.
  if (m.correcting) return {};
  if (m.pendingSince == null) return { pending: true };
  const at = finalEligibleAt(m) as number;
  if (at > now) {
    const h = Math.ceil((at - now) / 3_600_000);
    return { error: `${m.name} is pending finalization. Results are held at least 24 hours after the meet; about ${h} hour${h === 1 ? "" : "s"} to go.` };
  }
  if (m.complete !== true) {
    if (a.force !== true) return { error: `${m.name}'s results look incomplete. Check them, then use Finalize Anyway with a reason.` };
    if (!String(a.reason ?? "").trim()) return { error: "Give a reason for finalizing with incomplete results." };
    return { forced: true };
  }
  return {};
}

/** Next time the schedule needs attention (start, end, end of hold) — for alarms. */
export function nextScheduleAt(m: Meet, now: number): number | null {
  if (!isScheduled(m) || m.history || m.isDemo || m.archived || m.status === "FINAL" || m.correcting || m.lifecycle === "CANCELED" || m.lifecycle === "POSTPONED") return null;
  const cands: number[] = [];
  if ((m.startAt as number) > now) cands.push(m.startAt as number);
  if (m.pendingSince == null && m.endAt != null && m.endAt > now) cands.push(m.endAt);
  const at = finalEligibleAt(m);
  if (at !== null && at > now) cands.push(at);
  else if (at !== null && m.complete !== true) cands.push(now + 30 * 60_000);
  return cands.length ? Math.min(...cands) : null;
}
