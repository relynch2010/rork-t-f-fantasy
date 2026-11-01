// Stage 2: meet scheduling rules. Run: cd functions && bun test tests/schedule.test.ts
import { expect, test } from "bun:test";
import { emptyStats, type Meet } from "../meets";
import {
  applyLifecycle, applySchedule, finalEligibleAt, finalGate, meetStage, PENDING_HOLD_MS, rosterLocked, scheduleTick, utcToZoned, zonedToUtc,
} from "../schedule";

const H = 3_600_000;
const blank = (): Meet => ({
  id: "m1", name: "Spring Invite", date: "", week: 3, provider: "MANUAL", status: "UPCOMING", eventsUrl: "", rosterUrl: "", resultsUrl: "",
  isDemo: false, polling: false, createdAt: 0, startedAt: null, finalAt: null, lastSyncedAt: null, lastAttemptAt: null, nextSyncAt: null,
  syncCount: 0, sourceError: null, sourceErrorAt: null, failures: 0, stats: emptyStats(), demo: null,
});

test("9:00 AM New York start stays 9:00 AM across the spring-forward change", () => {
  // Sat 7 Mar 2026 is EST (UTC-5); Sun 8 Mar 2026 is EDT (UTC-4).
  expect(zonedToUtc("2026-03-07T09:00", "America/New_York")).toBe(Date.UTC(2026, 2, 7, 14, 0));
  expect(zonedToUtc("2026-03-08T09:00", "America/New_York")).toBe(Date.UTC(2026, 2, 8, 13, 0));
  expect(utcToZoned(Date.UTC(2026, 2, 8, 13, 0), "America/New_York")).toBe("2026-03-08T09:00");
});

test("fall-back change and other zones", () => {
  // Sun 1 Nov 2026: EDT ends at 2:00 AM. 9:00 AM that day is EST.
  expect(zonedToUtc("2026-11-01T09:00", "America/New_York")).toBe(Date.UTC(2026, 10, 1, 14, 0));
  expect(zonedToUtc("2026-10-31T09:00", "America/New_York")).toBe(Date.UTC(2026, 9, 31, 13, 0));
  expect(zonedToUtc("2026-04-11T10:00", "America/Los_Angeles")).toBe(Date.UTC(2026, 3, 11, 17, 0));
  expect(zonedToUtc("2026-04-11T10:00", "America/Phoenix")).toBe(Date.UTC(2026, 3, 11, 17, 0));
  expect(zonedToUtc("2026-02-30T10:00", "America/New_York")).toBeNull();
  expect(zonedToUtc("2026-04-11T10:00", "Not/AZone")).toBeNull();
});

test("multi-day meet across a DST change: roster lock at the official start", () => {
  const m = blank();
  const now = Date.UTC(2026, 2, 1);
  expect(applySchedule(m, { startLocal: "2026-03-07T09:00", endLocal: "2026-03-08T17:00", timeZone: "America/New_York" }, now)).toBeNull();
  expect(m.startAt).toBe(Date.UTC(2026, 2, 7, 14, 0));
  expect(m.endAt).toBe(Date.UTC(2026, 2, 8, 21, 0));
  expect(m.date).toBe("2026-03-07");
  expect(rosterLocked(m, (m.startAt as number) - 60_000)).toBe(false);
  expect(rosterLocked(m, m.startAt as number)).toBe(true);
  expect(meetStage(m, now)).toBe("SCHEDULED");
  expect(meetStage(m, (m.startAt as number) + 1)).toBe("LIVE");
});

test("end before start and over-long meets are rejected", () => {
  const m = blank();
  expect(applySchedule(m, { startLocal: "2026-04-11T10:00", endLocal: "2026-04-11T09:00", timeZone: "America/New_York" }, 0)).toContain("end after");
  expect(applySchedule(m, { startLocal: "2026-04-11T10:00", endLocal: "2026-04-30T09:00", timeZone: "America/New_York" }, 0)).toContain("7 days");
});

test("24-hour hold, and longer while results are incomplete", () => {
  const m = blank();
  applySchedule(m, { startLocal: "2026-04-11T09:00", endLocal: "2026-04-11T17:00", timeZone: "America/New_York" }, 0);
  const end = m.endAt as number;
  expect(scheduleTick(m, end - 1)).toBeNull();
  expect(scheduleTick(m, end)).toBe("pending");
  m.pendingSince = end;
  expect(meetStage(m, end + 1)).toBe("PENDING");
  expect(finalEligibleAt(m)).toBe(end + PENDING_HOLD_MS);
  m.complete = true;
  expect(scheduleTick(m, end + 23 * H)).toBeNull();
  expect(finalGate(m, {}, end + 23 * H).error).toContain("pending finalization");
  expect(scheduleTick(m, end + 24 * H)).toBe("final");
  m.complete = false;
  expect(scheduleTick(m, end + 25 * H)).toBe("incomplete");
  expect(finalGate(m, {}, end + 25 * H).error).toContain("incomplete");
  expect(finalGate(m, { force: true }, end + 25 * H).error).toContain("reason");
  expect(finalGate(m, { force: true, reason: "Timer confirmed" }, end + 25 * H).forced).toBe(true);
});

test("Mark Final before the meet ends starts the hold instead of finalizing", () => {
  const m = blank();
  applySchedule(m, { startLocal: "2026-04-11T09:00", endLocal: "2026-04-11T17:00", timeZone: "America/New_York" }, 0);
  expect(finalGate(m, {}, (m.startAt as number) + H).pending).toBe(true);
  m.pendingSince = (m.startAt as number) + H;
  // The hold is anchored to the official end even when the meet ended early.
  expect(finalEligibleAt(m)).toBe((m.endAt as number) + PENDING_HOLD_MS);
});

test("postpone, reschedule, cancel, interrupt keep the same matchup and are logged", () => {
  const m = blank();
  const t0 = Date.UTC(2026, 3, 1);
  applySchedule(m, { startLocal: "2026-04-11T09:00", timeZone: "America/New_York" }, t0);
  let r = applyLifecycle(m, "postpone", { reason: "Thunderstorms" }, "Coach", t0);
  expect(r.error).toBeNull();
  expect(meetStage(m, t0)).toBe("POSTPONED");
  expect(rosterLocked(m, (m.startAt as number) + H)).toBe(false);
  r = applyLifecycle(m, "reschedule", { startLocal: "2026-04-18T09:00", timeZone: "America/New_York" }, "Coach", t0);
  expect(r.error).toBeNull();
  expect(m.week).toBe(3);
  expect(meetStage(m, t0)).toBe("SCHEDULED");
  expect(m.startAt).toBe(Date.UTC(2026, 3, 18, 13, 0));
  m.status = "LIVE";
  expect(applyLifecycle(m, "interrupt", { reason: "Lightning" }, "Coach", (m.startAt as number) + H).error).toBeNull();
  expect(meetStage(m, (m.startAt as number) + H)).toBe("INTERRUPTED");
  expect(scheduleTick(m, (m.endAt as number) + 1)).toBeNull();
  r = applyLifecycle(m, "resume", {}, "Coach", (m.startAt as number) + 2 * H);
  expect(r.resumePolling).toBe(true);
  r = applyLifecycle(m, "cancel", { reason: "Track closed" }, "Coach", (m.startAt as number) + 3 * H);
  expect(r.closeWeek).toBe(true);
  expect(meetStage(m, 0)).toBe("CANCELED");
  expect(m.week).toBe(3);
  expect((m.changes ?? []).map((c) => c.kind)).toEqual(["postpone", "reschedule", "interrupt", "resume", "cancel"]);
});

test("final meets can't be rescheduled; corrections wait for the commissioner", () => {
  const m = blank();
  applySchedule(m, { startLocal: "2026-04-11T09:00", timeZone: "America/New_York" }, 0);
  m.status = "FINAL";
  expect(applyLifecycle(m, "postpone", {}, "Coach", 0).error).toContain("final");
  m.status = "LIVE"; m.correcting = 1; m.pendingSince = 1; m.complete = true;
  expect(scheduleTick(m, Date.UTC(2027, 0, 1))).toBeNull();
  expect(finalGate(m, {}, Date.UTC(2027, 0, 1))).toEqual({});
});

test("meets without a start time keep the original behavior", () => {
  const m = blank();
  expect(meetStage(m, Date.now())).toBe("SCHEDULED");
  expect(rosterLocked(m, Date.now())).toBe(false);
  expect(scheduleTick(m, Date.now())).toBeNull();
  expect(finalGate(m, {}, Date.now())).toEqual({});
  m.status = "LIVE";
  expect(meetStage(m, Date.now())).toBe("LIVE");
});
