// Stage 1: result matching respects the league's school. Run: cd functions && bun test tests/school_scope.test.ts
import { expect, test } from "bun:test";
import { matchPoolAthlete, type PoolAthlete, type SourceAthlete } from "../live";
import { CORNWALL_SCOPE, schoolScope } from "../names";

const pool: PoolAthlete[] = [
  { id: "liamtesta", name: "Liam Testa", gender: "B", school: "QA Testville High School" },
  { id: "avaquill", name: "Ava Quill", gender: "G", school: "QA Testville High School" },
];
const src = (first: string, last: string, school: string, gender: "B" | "G" = "B"): SourceAthlete => ({ first, last, gender, school, bib: null });
const scope = schoolScope("QA Testville HS");

test("same-school result matches the league's player", () => {
  const m = matchPoolAthlete(src("Liam", "Testa", "QA Testville High School"), "m1", pool, {}, new Map(), 1, new Map(), scope);
  expect(m.athleteId).toBe("liamtesta");
  expect(m.inPool).toBe(true);
});

test("same name at another school doesn't match", () => {
  const m = matchPoolAthlete(src("Liam", "Testa", "Cornwall Central"), "m1", pool, {}, new Map(), 1, new Map(), scope);
  expect(m.athleteId).toBeNull();
  expect(m.inPool).toBe(false);
});

test("school scope helpers", () => {
  expect(schoolScope("").cornwall).toBe(true);
  expect(schoolScope("Cornwall Central High School")).toBe(CORNWALL_SCOPE);
  expect(scope.cornwall).toBe(false);
  expect(scope.owns("QA Testville High School")).toBe(true);
  expect(scope.owns("")).toBe(false);
  expect(scope.owns("Cornwall Central")).toBe(false);
});

test("Cornwall leagues keep the original rule", () => {
  const m = matchPoolAthlete(src("Ava", "Quill", "QA Testville High School", "G"), "m1", pool, {}, new Map(), 1);
  expect(m.athleteId === "avaquill" && m.inPool).toBe(false);
});
