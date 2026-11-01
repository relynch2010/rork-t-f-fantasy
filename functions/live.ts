/**
 * Athlete matcher: source athlete → Fantasy T&F athlete, using the strongest evidence available.
 *   1. Confirmed mapping (per-meet bib, or name+gender+school confirmed by the commissioner)
 *   2. Exact normalized name + gender + school
 *   3. Exact normalized name + gender when the athlete has no school on file and the name is unique in the meet
 *   4. Normalized (nickname / one-typo) name + gender + school
 * Anything weaker is never applied automatically — it becomes an Unmatched Result for the commissioner.
 */
import { canonSchool, firstNamesAgree, identityKey, isPoolSchool, lastNamesAgree, looseNameMatch, norm, normSchool, poolSchoolOf, sameSchool, schoolsMatch, splitName } from "./names";
import type { Gender } from "./scoring";

export type PoolAthlete = { id: string; name: string; gender: Gender; school: string };

export type Mapping = {
  key: string;
  athleteId: string | null;
  /** Relay mappings: every fantasy athlete on that relay team. */
  athleteIds?: string[];
  rejected: string[];
  sourceName: string;
  school: string;
  gender: string;
  by: string;
  at: number;
};

export type SourceAthlete = {
  first: string; last: string; gender: Gender | null; school: string; bib: string | null;
  /** Persistent source athlete id (e.g. "anet:19255252"). */
  sourceId?: string | null;
  teamId?: string | null;
  region?: string | null;
  grade?: string | null;
};

/** A confirmed link between a source athlete id and a master player (stored once, globally). */
export type SourceLink = {
  sourceId: string; athleteId: string; name: string; school: string; gender: string; grade: string; provider: string;
  firstSeen: number; lastSeen: number; meets: number; conflict: string;
};

export type PoolMatch = {
  athleteId: string | null;
  /** source_id | mapping | alias | name_cornwall | review | conflict | out_of_pool | none */
  type: "source_id" | "mapping" | "alias" | "name_cornwall" | "review" | "conflict" | "out_of_pool" | "none";
  confidence: "high" | "medium" | "none";
  reason: string;
  candidates: string[];
  inPool: boolean;
  conflict?: string;
};

/** Source name and a link's stored name describe the same person (exact or nickname/one-typo with same last name). */
function sameIdentity(link: { name: string; gender: string }, src: SourceAthlete): boolean {
  if (src.gender && link.gender && link.gender !== src.gender) return false;
  const n = `${src.first} ${src.last}`.trim();
  return norm(link.name) === norm(n) || looseNameMatch(link.name, n);
}

/**
 * Fantasy T&F matcher (Cornwall Central pool). Evidence order:
 *   1. stored source athlete id (checked for conflicts)
 *   2. commissioner-confirmed association (bib / name mapping)
 *   3. exact normalized name + gender + Cornwall Central, unique in the pool AND unique in this meet
 * Anything weaker or ambiguous is NEEDS REVIEW; non-Cornwall athletes are never associated. Never guesses.
 */
export function matchPoolAthlete(
  src: SourceAthlete,
  meetId: string,
  pool: PoolAthlete[],
  mappings: Record<string, Mapping>,
  links: Map<string, SourceLink>,
  sameNameInMeet: number,
  /** Commissioner-confirmed aliases: identityKey(name)|gender → master player ids. */
  aliases: Map<string, string[]> = new Map(),
): PoolMatch {
  const ids = new Map(pool.map((a) => [a.id, a]));
  const rejected = new Set<string>();
  const full = fullNorm(src);
  const inPool = isPoolSchool(src.school, src.teamId, src.region);
  if (src.sourceId) {
    const link = links.get(src.sourceId);
    if (link?.conflict) {
      return { athleteId: null, type: "conflict", confidence: "none", reason: `SOURCE ID CONFLICT: ${link.conflict}`, candidates: ids.has(link.athleteId) ? [link.athleteId] : [], inPool, conflict: link.conflict };
    }
    if (link && ids.has(link.athleteId)) {
      if (!sameIdentity(link, src)) {
        const why = `${src.sourceId} is linked to ${link.name}, but this result says ${`${src.first} ${src.last}`.trim()}${src.school ? ` (${src.school})` : ""}.`;
        return { athleteId: null, type: "conflict", confidence: "none", reason: `SOURCE ID CONFLICT: ${why}`, candidates: [link.athleteId], inPool, conflict: why };
      }
      return { athleteId: link.athleteId, type: "source_id", confidence: "high", reason: `Same source athlete id (${src.sourceId}) seen in ${link.meets} earlier meet${link.meets === 1 ? "" : "s"}.`, candidates: [], inPool: true };
    }
  }
  for (const k of [src.bib ? bibKey(meetId, src.bib) : null, nameKey(src)]) {
    if (!k) continue;
    const m = mappings[k];
    if (!m) continue;
    for (const r of m.rejected) rejected.add(r);
    if (m.athleteId && ids.has(m.athleteId)) return { athleteId: m.athleteId, type: "mapping", confidence: "high", reason: `Confirmed by the commissioner (${m.by}).`, candidates: [], inPool: true };
  }
  if (!inPool) return { athleteId: null, type: "out_of_pool", confidence: "none", reason: src.school ? `${src.school} isn't Cornwall Central.` : "No school in the source, so Cornwall Central can't be confirmed.", candidates: [], inPool: false };
  if (!full || !src.gender) return { athleteId: null, type: "none", confidence: "none", reason: "The source has no usable name or gender.", candidates: [], inPool };
  const eligible = pool.filter((a) => !rejected.has(a.id) && a.gender === src.gender && sameSchool(poolSchoolOf(a.school), "Cornwall Central"));
  const srcKey = identityKey(`${src.first} ${src.last}`);
  const aliasIds = (aliases.get(`${srcKey}|${src.gender}`) ?? []).filter((id) => eligible.some((a) => a.id === id));
  if (aliasIds.length === 1 && sameNameInMeet <= 1) {
    return { athleteId: aliasIds[0] as string, type: "alias", confidence: "high", reason: `Confirmed alias "${`${src.first} ${src.last}`.trim()}" → ${ids.get(aliasIds[0] as string)?.name ?? ""} (saved by the Main League commissioner).`, candidates: [], inPool };
  }
  if (aliasIds.length > 1) {
    return { athleteId: null, type: "review", confidence: "none", reason: "This alias is confirmed for more than one player. Needs review.", candidates: aliasIds, inPool };
  }
  // Exact = same name after harmless differences only (accents, case, punctuation, hyphens, spacing, middle initial, suffix).
  const exact = eligible.filter((a) => norm(a.name) === full || (srcKey.length >= 4 && identityKey(a.name) === srcKey));
  if (exact.length === 1 && sameNameInMeet <= 1) {
    return { athleteId: (exact[0] as PoolAthlete).id, type: "name_cornwall", confidence: "high", reason: `Exact name + ${src.gender === "G" ? "girls" : "boys"} + Cornwall Central; the only player with this name.`, candidates: [], inPool };
  }
  if (exact.length > 1 || (exact.length === 1 && sameNameInMeet > 1)) {
    return { athleteId: null, type: "review", confidence: "none", reason: exact.length > 1 ? `${exact.length} Cornwall players share this name. Needs review.` : `Two Cornwall athletes named ${`${src.first} ${src.last}`.trim()} are in this meet. Needs review.`, candidates: exact.map((a) => a.id), inPool };
  }
  const loose = eligible.filter((a) => looseNameMatch(a.name, `${src.first} ${src.last}`));
  if (loose.length > 0) {
    return { athleteId: null, type: "review", confidence: "medium", reason: "Similar name (nickname or spelling) at Cornwall Central. Needs review before any points.", candidates: loose.map((a) => a.id).slice(0, 5), inPool };
  }
  return { athleteId: null, type: "none", confidence: "none", reason: "Cornwall Central athlete not in the player database.", candidates: [], inPool };
}

export { canonSchool, isPoolSchool };

export type MatchType = "bib" | "mapping" | "exact_school" | "exact_name" | "name_school";

export type Match = { athleteId: string | null; type: MatchType | null; rejected: Set<string> };

export function nameKey(s: SourceAthlete): string {
  return `n:${norm(s.first)}${norm(s.last)}|${s.gender ?? "X"}|${normSchool(s.school)}`;
}

export function bibKey(meetId: string, bib: string): string {
  return `b:${meetId}|${bib}`;
}

export function fullNorm(s: SourceAthlete): string {
  return norm(`${s.first}${s.last}`);
}

export function strongMatch(
  src: SourceAthlete,
  meetId: string,
  pool: PoolAthlete[],
  mappings: Record<string, Mapping>,
  sameNameInMeet: number,
  allowNameOnly = false,
): Match {
  const ids = new Set(pool.map((a) => a.id));
  const rejected = new Set<string>();
  const keys = [src.bib ? bibKey(meetId, src.bib) : null, nameKey(src)];
  for (const k of keys) {
    if (!k) continue;
    const m = mappings[k];
    if (!m) continue;
    for (const r of m.rejected) rejected.add(r);
    if (m.athleteId && ids.has(m.athleteId)) return { athleteId: m.athleteId, type: k.startsWith("b:") ? "bib" : "mapping", rejected };
  }
  const full = fullNorm(src);
  if (!full || !src.gender) return { athleteId: null, type: null, rejected };
  const eligible = pool.filter((a) => !rejected.has(a.id) && a.gender === src.gender);
  const exact = eligible.filter((a) => norm(a.name) === full);
  const exactSchool = exact.filter((a) => a.school && schoolsMatch(a.school, src.school));
  if (exactSchool.length === 1) return { athleteId: (exactSchool[0] as PoolAthlete).id, type: "exact_school", rejected };
  if (allowNameOnly && exact.length === 1 && !(exact[0] as PoolAthlete).school && sameNameInMeet === 1) {
    return { athleteId: (exact[0] as PoolAthlete).id, type: "exact_name", rejected };
  }
  if (exact.length === 0) {
    const loose = eligible.filter((a) => a.school && schoolsMatch(a.school, src.school) && looseNameMatch(a.name, `${src.first} ${src.last}`));
    if (loose.length === 1) return { athleteId: (loose[0] as PoolAthlete).id, type: "name_school", rejected };
  }
  return { athleteId: null, type: null, rejected };
}

/** Plausible-but-uncertain candidates for commissioner review. Athletes already confidently matched in this meet are excluded. */
export function weakCandidates(src: SourceAthlete, pool: PoolAthlete[], rejected: Set<string>, claimed: Set<string>): string[] {
  const full = fullNorm(src);
  const first = norm(src.first);
  const last = norm(src.last);
  if (!full) return [];
  return pool
    .filter((a) => !rejected.has(a.id) && !claimed.has(a.id) && (src.gender === null || a.gender === src.gender))
    .filter((a) => {
      if (norm(a.name) === full) return true;
      const s = splitName(a.name);
      const schoolKnownDifferent = !!a.school && !schoolsMatch(a.school, src.school);
      if (schoolKnownDifferent) return false;
      if (lastNamesAgree(s.last, last) && firstNamesAgree(s.first, first)) return true;
      if (s.last === last && last.length >= 3 && (s.first[0] === first[0] || (!!a.school && schoolsMatch(a.school, src.school)))) return true;
      return false;
    })
    .map((a) => a.id)
    .slice(0, 5);
}
