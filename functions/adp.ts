import { firstNamesAgree, lastNamesAgree, looseNameMatch, norm, splitName } from "./names";

/** Commissioner-provided draft rankings (ADP). Display/auto-pick order in the draft room only. */
export const DEFAULT_ADP: string[] = [
  "luke potter", "Madeline larkin", "Colin lewis", "owen vallinino", "lydia semo", "kassandra enos", "beya salerno",
  "aiden jean marie", "Daniel zvonic", "Noemi gioitia", "Ben bellamy", "Kaitlyn hartwig", "quetzi juarez", "Michael carey",
  "Jorie green", "Justin dume", "sky appleton", "richard williams", "Jason porter", "emma doyle", "james chowanski",
  "christian cibirka", "Chinagoram ihim", "cecelia cruz", "jeff dong", "ben huang", "bobby lynch", "connor tollman",
  "michael mccafferty", "justin alsxis", "brielle hudson", "ethan urena-barboza",
];

export type AdpMatch = "exact" | "fuzzy" | "manual" | "none" | "skipped";
export type AdpEntry = { name: string; athleteId: string | null; match: AdpMatch; candidates: string[] };

type PoolAthlete = { id: string; name: string };

/**
 * Matches ADP names to existing athletes. Exact normalized names match outright; a single nickname/one-typo
 * candidate is accepted as "fuzzy" (shown for review). Anything else is flagged — never creates an athlete.
 */
export function resolveAdp(names: string[], pool: PoolAthlete[], keep: AdpEntry[] = []): AdpEntry[] {
  const kept = new Map(keep.filter((e) => e.match === "manual" || e.match === "skipped").map((e) => [norm(e.name), e]));
  const used = new Set<string>();
  const out: AdpEntry[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const prior = kept.get(norm(name));
    if (prior && (prior.athleteId === null || pool.some((a) => a.id === prior.athleteId))) {
      out.push({ ...prior, name });
      if (prior.athleteId) used.add(prior.athleteId);
      continue;
    }
    const exact = pool.filter((a) => norm(a.name) === norm(name) && !used.has(a.id));
    if (exact.length === 1) {
      const id = (exact[0] as PoolAthlete).id;
      used.add(id);
      out.push({ name, athleteId: id, match: "exact", candidates: [] });
      continue;
    }
    const loose = pool.filter((a) => !used.has(a.id) && looseNameMatch(a.name, name));
    if (loose.length === 1 && exact.length === 0) {
      const id = (loose[0] as PoolAthlete).id;
      used.add(id);
      out.push({ name, athleteId: id, match: "fuzzy", candidates: [] });
      continue;
    }
    const { first, last } = splitName(name);
    const cands = pool
      .filter((a) => !used.has(a.id))
      .filter((a) => {
        const s = splitName(a.name);
        return lastNamesAgree(s.last, last) || (firstNamesAgree(s.first, first) && s.last.slice(0, 3) === last.slice(0, 3));
      })
      .map((a) => a.id)
      .slice(0, 5);
    out.push({ name, athleteId: null, match: "none", candidates: [...new Set([...exact.map((a) => a.id), ...loose.map((a) => a.id), ...cands])].slice(0, 6) });
  }
  return out;
}
