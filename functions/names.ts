/** Name + school helpers shared by the athlete matcher and the ADP resolver. */

export function norm(text: string): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Splits "Bobby Lynch" / "Lynch, Bobby" into first + last (normalized). */
export function splitName(full: string): { first: string; last: string } {
  const raw = (full ?? "").trim();
  if (raw.includes(",")) {
    const [last, first] = raw.split(",").map((s) => s.trim());
    return { first: norm((first ?? "").split(/\s+/)[0] ?? ""), last: norm(last ?? "") };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: norm(parts[0] ?? ""), last: "" };
  return { first: norm(parts[0] ?? ""), last: norm(parts.slice(1).join(" ")) };
}

export function normSchool(school: string): string {
  return norm(school).replace(/(highschool|seniorhigh|hs|school|academy)$/g, "");
}

/** The Fantasy T&F athlete pool's school. Master players with no school on file belong to it. */
export const POOL_SCHOOL = "Cornwall Central";
/** Source team ids that are officially Cornwall Central (Athletic.net team 9730). */
export const POOL_TEAM_IDS = new Set<string>(["anet:9730"]);

/** Explicit official naming variants only (never fuzzy). "COCE" is AthleticLIVE's abbreviation for Cornwall Central. */
const SCHOOL_ALIASES: Record<string, string> = { coce: "cornwallcentral" };

/**
 * Canonical school identity: case, punctuation, whitespace and common suffixes (High School, HS, School, School District,
 * CSD, UFSD) are ignored. "Cornwall Central High School" → "cornwallcentral". A different school stays different
 * ("Cornwall Central Middle School" → "cornwallcentralmiddle").
 */
export function canonSchool(raw: string): string {
  let x = norm(raw);
  for (let i = 0; i < 3; i++) {
    const next = x.replace(/(schooldistrict|centralschooldistrict|csd|ufsd|highschool|seniorhigh|jrsrhigh|hs|school|academy)$/, (m) => (m === "centralschooldistrict" ? "central" : ""));
    if (next === x) break;
    x = next;
  }
  return SCHOOL_ALIASES[x] ?? x;
}

/** Same canonical school (exact, never "contains"). */
export function sameSchool(a: string, b: string): boolean {
  const x = canonSchool(a);
  return !!x && x === canonSchool(b);
}

/**
 * The source athlete's school is the Fantasy athlete pool's school: by official team id, by canonical name, or the bare
 * team label "Cornwall" at a New York meet (how local timers label Cornwall Central). A bare "Cornwall" anywhere else
 * (Cornwall, Ontario; Cornwall, PA) is never treated as Cornwall Central.
 */
export function isPoolSchool(school: string, teamId?: string | null, region?: string | null): boolean {
  if (teamId && POOL_TEAM_IDS.has(teamId)) return true;
  if (sameSchool(school, POOL_SCHOOL)) return true;
  return canonSchool(school) === "cornwall" && /(^|[^a-z])(ny|new york)([^a-z]|$)/i.test(region ?? "");
}

/** A pool athlete's school (master players with no school on file are Cornwall Central). */
export function poolSchoolOf(school: string | undefined | null): string {
  return (school ?? "").trim() || POOL_SCHOOL;
}

/** Schools match when one normalized name contains the other (min 4 chars). */
export function schoolsMatch(a: string, b: string): boolean {
  const x = normSchool(a);
  const y = normSchool(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 4 || y.length < 4) return false;
  return x.includes(y) || y.includes(x);
}

const NICK: string[][] = [
  ["ben", "benjamin", "benji"], ["mike", "michael", "mikey"], ["matt", "matthew"], ["dan", "daniel", "danny"],
  ["chris", "christopher", "christian"], ["will", "william", "liam", "billy"], ["nick", "nicholas", "nicolas"],
  ["alex", "alexander", "alexandra", "alexis"], ["sam", "samuel", "samantha", "sammy"], ["tom", "thomas", "tommy"],
  ["joe", "joseph", "joey"], ["jon", "jonathan", "john", "johnny"], ["bob", "bobby", "rob", "robbie", "robert", "bert"],
  ["liz", "beth", "elizabeth", "eliza"], ["kate", "katie", "katherine", "kathryn", "catherine", "cate"],
  ["abby", "abigail"], ["maddie", "madeline", "madison", "maddy"], ["josh", "joshua"], ["jake", "jacob"],
  ["tony", "anthony"], ["andy", "drew", "andrew"], ["zach", "zachary", "zack"], ["nate", "nathan", "nathaniel"],
  ["gabby", "gabriella", "gabrielle", "gabriel", "gabe"], ["jeff", "jeffrey"], ["greg", "gregory"], ["steve", "steven", "stephen"],
  ["ed", "eddy", "eddie", "edward"], ["jim", "jimmy", "james", "jamie"], ["dave", "david"], ["rich", "rick", "richard", "ricky"],
  ["charlie", "charles", "chuck"], ["ellie", "eleanor", "ella"], ["jess", "jessica", "jessie"], ["mj", "michael"],
  ["izzy", "isabella", "isabel"], ["sophie", "sophia"], ["ceci", "cecilia", "cecelia"], ["pat", "patrick", "patricia"],
];

function nickGroup(first: string): Set<string> {
  const out = new Set<string>([first]);
  for (const g of NICK) if (g.includes(first)) for (const n of g) out.add(n);
  return out;
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Loose first-name agreement: equal, nickname, initial, or one typo on longer names. */
export function firstNamesAgree(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (nickGroup(a).has(b)) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  if (a.length >= 4 && b.length >= 4 && editDistance(a, b) <= 1) return true;
  return false;
}

export function lastNamesAgree(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const longer = Math.max(a.length, b.length);
  if (longer >= 5 && editDistance(a, b) <= (longer >= 8 ? 2 : 1)) return true;
  // "jeanmarie" vs "marie", hyphenated names
  return (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

/**
 * Identity key that tolerates harmless differences only: accents, case, punctuation, apostrophes, hyphens, spacing,
 * a middle initial and a Jr/Sr/II/III/IV suffix. "Ethan J. Ureña-Barboza Jr." → "ethanurenabarboza". Nicknames and typos are
 * NOT folded here (those always go to review until the commissioner confirms an alias).
 */
export function identityKey(full: string): string {
  const raw = (full ?? "").includes(",") ? (() => { const [l, f] = full.split(","); return `${f ?? ""} ${l ?? ""}`; })() : full ?? "";
  const parts = raw
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[.'’`]/g, "").replace(/[-_]/g, " ")
    .split(/\s+/).filter(Boolean)
    .filter((p) => !/^(jr|sr|ii|iii|iv)$/.test(p));
  const kept = parts.filter((p, i) => !(p.length === 1 && i > 0 && i < parts.length - 1));
  return kept.join("").replace(/[^a-z0-9]/g, "");
}

/** Loose full-name agreement used to build candidate lists (never auto-applied without other evidence). */
export function looseNameMatch(a: string, b: string): boolean {
  const x = splitName(a);
  const y = splitName(b);
  if (norm(a) === norm(b)) return true;
  return lastNamesAgree(x.last, y.last) && firstNamesAgree(x.first, y.first);
}
