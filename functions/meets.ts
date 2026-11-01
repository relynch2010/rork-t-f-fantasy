/**
 * Live meet ingestion: source adapters → NormalizedMeetResult.
 *
 * Adapters (AthleticLIVE HTTP feed, commissioner-pasted feed, demo generator) only produce raw text in the
 * AthleticLIVE generic format (events / roster / results) or Athletic.net column-headed CSV. Everything after
 * that — parsing, event identification, heat/overall placement, completeness — is shared, so a new provider
 * only needs a new adapter.
 */
import { eventInfo, EVENT_NAMES, keyOf, parseMark, type Gender } from "./scoring";
import { norm, normSchool } from "./names";

export type Provider = "ATHLETICLIVE" | "MANUAL" | "DEMO";
export type MeetStatus = "UPCOMING" | "LIVE" | "FINAL";
export type Completeness = "LIVE" | "PRELIM" | "FINAL";
/** NM = competed but no valid mark (NH / ND / FOUL): participation only, never a guessed mark. */
export type SourceStatus = "OK" | "DQ" | "DNF" | "DNS" | "NM";
export type Round = "PRELIM" | "FINAL";

export type MeetStats = {
  processed: number;
  events: number;
  eventsFlagged: number;
  sourceAthletes: number;
  matched: number;
  relevant: number;
  unmatched: number;
  scored: number;
  lastChangeAt: number | null;
};

export type Meet = {
  /** League-local end-to-end rehearsal meet (throwaway test leagues only). Never archived by the global setup. */
  testMeet?: boolean;
  /** History meet (earlier/prior-season results): feeds PB/SB history and projections, never earns fantasy points. */
  history?: boolean;
  /** Rehearsal only: which slice of the real feed the next import sees (arrival order, live state, official corrections). */
  testMode?: { include?: string[]; partial?: boolean; mutate?: { eventId: string; athlete: string; set: Record<string, string> }[] } | null;
  id: string;
  name: string;
  date: string;
  week: number;
  provider: Provider;
  status: MeetStatus;
  eventsUrl: string;
  rosterUrl: string;
  resultsUrl: string;
  isDemo: boolean;
  polling: boolean;
  createdAt: number;
  startedAt: number | null;
  finalAt: number | null;
  lastSyncedAt: number | null;
  lastAttemptAt: number | null;
  nextSyncAt: number | null;
  syncCount: number;
  sourceError: string | null;
  sourceErrorKind?: "unreachable" | "format" | "config" | null;
  sourceErrorAt: number | null;
  failures: number;
  stats: MeetStats;
  feedHash?: string;
  /** The one public meet link the commissioner pasted (AthleticLIVE meet page or a timer's results folder). */
  sourceUrl?: string;
  /** Outcome of resolving `sourceUrl` into machine-readable feeds. Never marked ok unless the results feed actually read. */
  resolve?: { ok: boolean; kind: string; message: string; at: number } | null;
  /** Event schedule from the events feed (start times drive per-player lineup locks). */
  schedule?: EventSlot[];
  /** Fantasy athleteId → source event ids they appear in (entries or results). */
  entries?: Record<string, string[]>;
  /** Fantasy athleteId → catalog events they appear in (projection evidence). */
  entryEvents?: Record<string, string[]>;
  /** Source event id → first time any result posted in it (lock fallback when no start time is published). */
  eventsStarted?: Record<string, number>;
  /** "gender|event" finished in this meet (every row complete). */
  completedEvents?: string[];
  /** Scored events that have no active performance table (result stored, no time/mark points). */
  tablesMissing?: string[];
  /** "gender|event" → complete-field profile (size, strength, sorted marks/seeds) from the latest import. */
  fieldProfile?: Record<string, { size: number; strength: number | null; marks: number[]; fromSeeds: boolean }>;
  /** "global": a Main League meet shared by every league. "local" (or unset): an old league-only meet. */
  scope?: "global" | "local";
  /** Old league-only meet kept for its points but no longer run (meets are global now). */
  archived?: boolean;
  /** Last time the source feed content changed (drives automatic FINAL). */
  feedChangedAt?: number | null;
  /** League-local: the finalAt this league already closed out, so a repeated final signal is handled once. */
  finalSeen?: number | null;
  /** League-local: signature of the global feed this league last scored (skips re-scoring unchanged data). */
  seenFeed?: string | null;
  /** Global: set by the Main League's "Reprocess meet"; every league rebuilds this meet's results once per value. */
  reprocessAt?: number | null;
  /** League-local: the reprocessAt this league already handled. */
  reprocessSeen?: number | null;
  /** Verified AthleticLIVE meet number behind `sourceUrl` (results are read straight from AthleticLIVE). */
  sourceMeetId?: string | null;
  /** What the verified source said about the meet (name/date/location/timer), for the commissioner. */
  sourceInfo?: { name: string; date: string; location: string; timer: string; url: string } | null;
  /** Last Test Connection outcome (global). */
  lastTest?: { at: number; ok: boolean; message: string; results: number; matched: number } | null;
  /** Demo meets only: simulated totals that never touch real scoring. */
  demo?: { teams: { teamId: string; points: number }[]; athletes: { athleteId: string; points: number; events: number }[] } | null;
};

export type RawFeed = { events: string; roster: string; results: string };

/** One scheduled event from the AthleticLIVE events file. `startAt` is UTC ms (null when not published). */
export type EventSlot = { id: string; name: string; event: string | null; gender: Gender | null; startAt: number | null };

export type Member = { first: string; last: string; bib: string | null };

export type NormalizedMeetResult = {
  id: string;
  meetId: string;
  sourceEventId: string;
  eventName: string;
  event: string | null;
  relay: boolean;
  gender: Gender | null;
  round: Round;
  raceId: string | null;
  heat: number | null;
  athleteSourceId: string | null;
  bib: string | null;
  athleteName: string;
  firstName: string;
  lastName: string;
  school: string;
  grade: string;
  place: number | null;
  heatPlace: number | null;
  livePlace: number | null;
  mark: string;
  splits: string[];
  resultStatus: SourceStatus;
  seededCount: number | null;
  completeness: Completeness;
  /** This athlete's heat/flight has every result posted (heat-win bonus can be awarded). */
  heatComplete: boolean;
  relayMembers: Member[];
  timestamp: number;
  /** Persistent source athlete id when the source publishes one (e.g. "anet:19255252"). */
  sourceAthleteId?: string | null;
  /** Source team id (e.g. "anet:9730"). */
  teamId?: string | null;
  seedMark?: string;
  wind?: string;
  /** Athlete's PR / season record before this meet, as published by the source. */
  srcPb?: string;
  srcSb?: string;
  /** Where exactly this row came from (source document + row id). */
  sourceRef?: string;
  /** Meet region from the source (e.g. "NY"); used only to read a bare "Cornwall" team label as Cornwall Central. */
  region?: string;
  /** Same competition across rounds (prelims + finals of one event section). */
  compKey?: string;
  /** Relay team designation (A/B). */
  relayDesig?: string;
  /** Number of heats/flights the event was run in. */
  heats?: number;
  /** Source said this event's results are official/final. */
  sourceFinal?: boolean | null;
};

export type NormalizeOutput = {
  rows: NormalizedMeetResult[];
  unknownEvents: { sourceEventId: string; eventName: string; rows: number }[];
  format: "generic" | "columns" | "empty";
  /** Division ids listed in the events feed (used to detect when every event has results). */
  listedEvents: string[];
};

export const emptyStats = (): MeetStats => ({
  processed: 0, events: 0, eventsFlagged: 0, sourceAthletes: 0, matched: 0, relevant: 0, unmatched: 0, scored: 0, lastChangeAt: null,
});

export class SourceError extends Error {
  constructor(message: string, readonly kind: "unreachable" | "format" | "config") {
    super(message);
  }
}

// MARK: - Adapters

const MAX_BYTES = 3_000_000;

function validUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u;
  } catch {
    return null;
  }
}

export async function getText(label: string, raw: string): Promise<string> {
  const url = validUrl(raw);
  if (!url) throw new SourceError(`${label} URL isn't a valid web address.`, "config");
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "Cache-Control": "no-cache", Accept: "text/csv, text/plain, application/json, */*", "User-Agent": "FantasyTF-LiveScoring/1.0" },
      signal: AbortSignal.timeout(9000),
    });
  } catch (e) {
    throw new SourceError(`${label} source can't be reached (${e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error"}).`, "unreachable");
  }
  if (!res.ok) throw new SourceError(`${label} source returned HTTP ${res.status}.`, "unreachable");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new SourceError(`${label} source is too large to process.`, "format");
  const trimmed = text.trimStart().toLowerCase();
  if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) {
    throw new SourceError(`${label} URL returned a web page, not a data feed. Use the machine-readable feed URL, not the public meet page.`, "format");
  }
  return text;
}

/** AthleticLIVEAdapter: three HTTP endpoints in the AthleticLIVE generic format (events optional, roster optional). */
export async function fetchAthleticLive(meet: Pick<Meet, "eventsUrl" | "rosterUrl" | "resultsUrl">): Promise<RawFeed> {
  if (!meet.resultsUrl.trim()) throw new SourceError("Add the Results URL first.", "config");
  const [events, roster, results] = await Promise.all([
    meet.eventsUrl.trim() ? getText("Events", meet.eventsUrl) : Promise.resolve(""),
    meet.rosterUrl.trim() ? getText("Roster", meet.rosterUrl) : Promise.resolve(""),
    getText("Results", meet.resultsUrl),
  ]);
  return { events, roster, results };
}

/** Result of turning one pasted meet link into feed URLs. */
export type Resolution = {
  ok: boolean;
  kind: "alive-folder" | "athleticlive-page" | "invalid";
  message: string;
  meetId: string | null;
  eventsUrl: string;
  rosterUrl: string;
  resultsUrl: string;
  events: number;
  results: number;
};

/** Generic AthleticLIVE results (% sections), a column-headed results CSV, or empty (before the meet starts). */
function looksLikeResults(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[{[]/.test(t)) return false;
  if (t.split(/\r?\n/).some((l) => l.trim().startsWith("%"))) return true;
  const header = (parseCsv(t)[0] ?? []).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return header.includes("event") && (header.includes("result") || header.includes("mark") || header.includes("time"));
}

async function probe(url: string): Promise<{ ok: boolean; text: string; why: string }> {
  try {
    const text = await getText("Feed", url);
    return { ok: true, text, why: "" };
  } catch (e) {
    return { ok: false, text: "", why: e instanceof Error ? e.message : "unreachable" };
  }
}

/**
 * Resolves the one meet link a commissioner pastes into the three AthleticLIVE generic feeds.
 *  - A timer's results folder (or any alive_*.csv file in it): events/roster/results are derived from the folder.
 *  - An AthleticLIVE public meet page (live.athletic.net/meets/<id>, *.anet.live): the meet number is read and the
 *    standard feed file names are tried on that host. AthleticLIVE does not publish a documented public data feed for
 *    its meet pages, so when nothing machine-readable answers this reports failure plainly. It never pretends.
 */
export async function resolveMeetLink(raw: string): Promise<Resolution> {
  const fail = (kind: Resolution["kind"], message: string, meetId: string | null = null): Resolution =>
    ({ ok: false, kind, message, meetId, eventsUrl: "", rosterUrl: "", resultsUrl: "", events: 0, results: 0 });
  const url = validUrl(raw);
  if (!url) return fail("invalid", "That isn't a valid web address. Paste the meet's public link (https://…).");
  const host = url.hostname.toLowerCase();
  const meetMatch = url.pathname.match(/\/meets?\/(\d{2,9})/i);
  const isAlivePage = /(^|\.)live\.athletic\.net$|\.anet\.live$|(^|\.)athletic\.live$|live\.rapidresultstiming\.com$/.test(host) && !/\.csv$/i.test(url.pathname);
  if (isAlivePage) {
    const meetId = meetMatch?.[1] ?? null;
    if (!meetId) return fail("athleticlive-page", "That AthleticLIVE link doesn't include a meet number. Open the meet and copy the link from the address bar (…/meets/12345).");
    const page = await fetch(`${url.origin}/meets/${meetId}`, { headers: { "User-Agent": "FantasyTF-LiveScoring/1.0" }, signal: AbortSignal.timeout(9000) }).catch(() => null);
    if (!page || !page.ok) return fail("athleticlive-page", `AthleticLIVE meet ${meetId} couldn't be reached (${page ? `HTTP ${page.status}` : "network error"}). Check the link.`, meetId);
    for (const base of [`${url.origin}/meets/${meetId}/`, `${url.origin}/meets/${meetId}/data/`]) {
      const results = await probe(`${base}alive_results.csv`);
      if (!results.ok || !looksLikeResults(results.text)) continue;
      const [events, roster] = await Promise.all([probe(`${base}alive_events.csv`), probe(`${base}alive_roster.csv`)]);
      return {
        ok: true, kind: "athleticlive-page", meetId, message: `Found AthleticLIVE data for meet ${meetId}.`,
        eventsUrl: events.ok ? `${base}alive_events.csv` : "", rosterUrl: roster.ok ? `${base}alive_roster.csv` : "", resultsUrl: `${base}alive_results.csv`,
        events: events.ok ? parseCsv(events.text).length : 0, results: parseCsv(results.text).length,
      };
    }
    return fail(
      "athleticlive-page",
      `Meet ${meetId} was found on AthleticLIVE, but its public page doesn't offer a data feed the server can read (AthleticLIVE has no public results API). Open Advanced and paste the meet's three AthleticLIVE data links (Events, Roster, Results) from the timer.`,
      meetId,
    );
  }
  // A results folder, or a direct alive_*.csv link inside it.
  const path = url.pathname.replace(/[^/]*\.csv$/i, "").replace(/\/?$/, "/");
  const base = `${url.origin}${path}`;
  const qs = url.search;
  const results = await probe(`${base}alive_results.csv${qs}`);
  if (results.ok && !looksLikeResults(results.text)) {
    return fail("alive-folder", "A file was found at that link, but it isn't AthleticLIVE results data. Use the meet's AthleticLIVE data folder, or paste the three data links under Advanced.");
  }
  if (!results.ok) {
    return fail("alive-folder", `No AthleticLIVE results file was found at that link (${results.why.replace(/^Feed /, "")}). Use the meet's AthleticLIVE data folder, or paste the three data links under Advanced.`);
  }
  const [events, roster] = await Promise.all([probe(`${base}alive_events.csv${qs}`), probe(`${base}alive_roster.csv${qs}`)]);
  return {
    ok: true, kind: "alive-folder", meetId: meetMatch?.[1] ?? null,
    message: `Found the results feed${events.ok ? ", event schedule" : ""}${roster.ok ? " and athlete list" : ""}.${events.ok ? "" : " No event schedule was published, so players lock when their event's first result appears."}`,
    eventsUrl: events.ok ? `${base}alive_events.csv${qs}` : "", rosterUrl: roster.ok ? `${base}alive_roster.csv${qs}` : "", resultsUrl: `${base}alive_results.csv${qs}`,
    events: events.ok ? parseCsv(events.text).length : 0, results: parseCsv(results.text).length,
  };
}

/**
 * Event schedule from the AthleticLIVE events file:
 * division_id, event_name, event_length, event_length_unit, event_start_date (MM/DD/YYYY), event_start_time (HH:MM:SS).
 * Local meet times are converted to UTC with the league's time-zone offset.
 */
export function parseSchedule(text: string, tzOffsetMin: number): EventSlot[] {
  const out: EventSlot[] = [];
  for (const r of parseCsv(text)) {
    const [id, name, , , dateRaw, timeRaw] = r;
    if (!id || !name || /division|event_?id/i.test(id)) continue;
    const div = parseDivision(name);
    let startAt: number | null = null;
    const d = (dateRaw ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) ?? (dateRaw ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = (timeRaw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
    if (d && t) {
      const iso = (dateRaw ?? "").includes("-");
      const y = Number(iso ? d[1] : d[3]);
      const mo = Number(iso ? d[2] : d[1]);
      const day = Number(iso ? d[3] : d[2]);
      let h = Number(t[1]);
      const ap = (t[4] ?? "").toLowerCase();
      if (ap.startsWith("p") && h < 12) h += 12;
      if (ap.startsWith("a") && h === 12) h = 0;
      const local = Date.UTC(y, mo - 1, day, h, Number(t[2]), Number(t[3] ?? 0));
      // A 00:00:00 start usually means "not scheduled"; treat it as unknown rather than locking at midnight.
      if (Number.isFinite(local) && !(h === 0 && Number(t[2]) === 0 && !ap)) startAt = local - tzOffsetMin * 60_000;
    }
    out.push({ id, name, event: div.event, gender: div.gender, startAt });
  }
  return out;
}

// MARK: - CSV

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((s) => s.trim())).filter((r) => r.some((s) => s !== ""));
}

// MARK: - Event identification

export type DivInfo = { gender: Gender | null; event: string | null; relay: boolean; round: Round; heat: number | null; compiled: boolean };

export function genderFrom(raw: string): Gender | null {
  const t = raw.trim().toLowerCase();
  if (["m", "b", "male", "boy", "boys", "men", "mens"].includes(t)) return "B";
  if (["f", "g", "w", "female", "girl", "girls", "women", "womens"].includes(t)) return "G";
  return null;
}

/** Maps a source division/event title ("Boys 55 Meter Dash Heat 3", "G 4x4", "Girls Shot Put Flight 2") to a catalog event. */
export function parseDivision(name: string): DivInfo {
  let t = ` ${name.toLowerCase().replace(/[’']/g, "").replace(/[_/|()[\]:;-]+/g, " ")} `;
  let gender: Gender | null = null;
  if (/\s(boys?|men|mens|male)\s/.test(t) || /^\s(b|m)\s/.test(t)) gender = "B";
  else if (/\s(girls?|women|womens|female|ladies)\s/.test(t) || /^\s(g|w|f)\s/.test(t)) gender = "G";
  const heatMatch = t.match(/\s(?:heat|section|sec|flight|flt|race)\s*#?\s*(\d+)/);
  const heat = heatMatch ? Number(heatMatch[1]) : null;
  const round: Round = /\s(prelim\w*|trials?|semi\w*|qualif\w*)\s/.test(t) ? "PRELIM" : "FINAL";
  t = t
    .replace(/\s(?:heat|section|sec|flight|flt|race)\s*#?\s*\d+/g, " ")
    .replace(/\sevent\s*#?\s*\d+/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/\s(boys?|men|mens|male|girls?|women|womens|female|ladies)\s/g, " ")
    .replace(/^\s(b|m|g|w|f)\s/, " ")
    .replace(/\s(varsity|jv|junior varsity|frosh|freshm[ae]n|soph\w*|open|championships?|invitational|unseeded|seeded|fast|slow|elite|final[s]?|prelim\w*|trials?|semi\w*|qualif\w*|dash|run|meters?|metres?|indoor|outdoor|hs|high school|division \w+|div \w+|timed)\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const relay = /relay|4\s*x|smr|dmr|medley|shuttle/.test(t);
  let ev: string | null = null;
  if (relay) {
    if (/smr|sprint medley/.test(t)) ev = "Sprint Medley Relay";
    else if (/dmr|distance medley/.test(t)) ev = "Distance Medley Relay";
    else if (/shuttle/.test(t)) ev = "Shuttle Hurdle Relay";
    else {
      const m = t.match(/4\s*x\s*(\d+)/);
      const leg = m ? Number(m[1]) : 0;
      const full = leg === 1 ? 100 : leg === 2 ? 200 : leg === 4 ? 400 : leg === 8 ? 800 : leg;
      if ([100, 200, 400, 800].includes(full)) ev = `4x${full} Relay`;
    }
  } else if (/pentathlon/.test(t)) ev = "Pentathlon";
  else if (/heptathlon/.test(t)) ev = "Heptathlon";
  else if (/decathlon/.test(t)) ev = "Decathlon";
  else if (/high\s*jump|\bhj\b/.test(t)) ev = "High Jump";
  else if (/pole\s*vault|\bpv\b/.test(t)) ev = "Pole Vault";
  else if (/long\s*jump|\blj\b/.test(t)) ev = "Long Jump";
  else if (/triple\s*jump|\btj\b/.test(t)) ev = "Triple Jump";
  else if (/shot|\bsp\b/.test(t)) ev = "Shot Put";
  else if (/discus/.test(t)) ev = "Discus";
  else if (/javelin/.test(t)) ev = "Javelin";
  else if (/weight/.test(t)) ev = "Weight Throw";
  else if (/hammer/.test(t)) ev = "Hammer";
  else if (/steeple/.test(t)) ev = "2000m Steeplechase";
  else if (/walk/.test(t)) ev = "1500m Racewalk";
  else if (/hurdle|\b\d+\s*m?\s*(hh|lh|ih|h)\b/.test(t)) {
    const m = t.match(/(\d{2,3})/);
    if (m) ev = `${m[1]}m Hurdles`;
  } else if (/\b2\s*mile/.test(t)) ev = "2 Mile";
  else if (/\b(1\s*)?mile\b/.test(t)) ev = "Mile";
  else {
    const m = t.match(/\b(\d{2,5})\s*m?\b/);
    if (m) ev = `${Number(m[1])}m`;
  }
  const hit = ev ? EVENT_NAMES.find((n) => keyOf(n) === keyOf(ev as string)) ?? null : null;
  return { gender, event: hit, relay: hit ? eventInfo(hit).relay : relay, round, heat, compiled: heat === null };
}

// MARK: - Parsing into rows

type RawRow = {
  divisionId: string;
  divisionName: string;
  placeRaw: string;
  heatPlaceRaw: string;
  heatRaw: string;
  roundRaw: string;
  bib: string;
  first: string;
  last: string;
  gender: string;
  grade: string;
  team: string;
  mark: string;
  splits: string[];
  seededRaw: string;
  statusRaw: string;
  members: Member[];
  relayFlag: boolean;
  teamId?: string;
  athleteId?: string;
  seedMark?: string;
  wind?: string;
  /** Source says this event is official/final (true) or still live (false). null = not stated. */
  finalFlag?: boolean | null;
  pb?: string;
  sb?: string;
  ref?: string;
  region?: string;
  /** Relay team designation (A/B) so two relays from one school stay separate. */
  desig?: string;
  /** Each source event is its own competition (explicit event ids): never merged with a same-named event. */
  splitByEvent?: boolean;
};

type RosterEntry = { bib: string; first: string; last: string; gender: string; grade: string; team: string };

function parseRoster(text: string): Map<string, RosterEntry> {
  const out = new Map<string, RosterEntry>();
  for (const r of parseCsv(text)) {
    const [bib, last, first, gender, grade, team] = r;
    if (!bib || /bib|comp/i.test(bib)) continue;
    out.set(bib, { bib, last: last ?? "", first: first ?? "", gender: gender ?? "", grade: grade ?? "", team: team ?? "" });
  }
  return out;
}

function parseEvents(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of parseCsv(text)) {
    const [id, name] = r;
    if (!id || !name || /division|event_?id/i.test(id)) continue;
    out.set(id, name);
  }
  return out;
}

/** AthleticLIVE generic results: "%<division_id>,<event_name>" headers, then place,bib,last,first,gender,grade,team,time,splits… */
function parseGeneric(text: string, roster: Map<string, RosterEntry>, events: Map<string, string>): RawRow[] {
  const out: RawRow[] = [];
  let divId = "";
  let divName = "";
  for (const r of parseCsv(text)) {
    const first = r[0] ?? "";
    if (first.startsWith("%")) {
      divId = first.slice(1).trim();
      divName = (r.slice(1).join(" ").trim() || events.get(divId)) ?? divId;
      continue;
    }
    if (!divId) continue;
    const bib = r[1] ?? "";
    const ros = roster.get(bib);
    out.push({
      divisionId: divId, divisionName: divName,
      placeRaw: first, heatPlaceRaw: "", heatRaw: "", roundRaw: "",
      bib,
      last: r[2] || ros?.last || "",
      first: r[3] || ros?.first || "",
      gender: r[4] || ros?.gender || "",
      grade: r[5] || ros?.grade || "",
      team: r[6] || ros?.team || "",
      mark: r[7] ?? "",
      splits: r.slice(8).filter((s) => s !== ""),
      seededRaw: "", statusRaw: "", members: [], relayFlag: false,
    });
  }
  return out;
}

/** Athletic.net column-headed format (Type, Gender, Event, Round, Heat, HeatPlace, Place, Result, Team, FirstName1, LastName1…). */
function parseColumns(rows: string[][]): RawRow[] {
  const header = (rows[0] ?? []).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const col = (...names: string[]): number => header.findIndex((h) => names.includes(h));
  const idx = {
    type: col("type"), gender: col("gender"), division: col("division"), event: col("event", "eventname"),
    seed: col("seeded", "seedcount", "entries"), round: col("round"), heat: col("heat", "flight", "section"),
    heatPlace: col("heatplace", "flightplace", "sectionplace"), place: col("place", "overallplace"),
    result: col("result", "mark", "time"), team: col("team", "school", "institution"),
    first: col("firstname1", "firstname", "first"), last: col("lastname1", "lastname", "last"),
    grade: col("grade1", "grade"), g1: col("gender1"), bib: col("bib", "bib1", "regid1", "compnumber"), status: col("status"),
    eventId: col("eventid", "divisionid", "eventnumber"),
    teamId: col("teamid"), athleteId: col("athleteid"), seedMark: col("seedmark"), wind: col("wind"), final: col("final"),
    pb: col("pb", "pr"), sb: col("sb", "sr"), ref: col("sourceref"), desig: col("relay", "designation"), region: col("region"),
  };
  const get = (r: string[], i: number): string => (i >= 0 ? r[i] ?? "" : "");
  const out: RawRow[] = [];
  for (const r of rows.slice(1)) {
    const eventName = [get(r, idx.gender), get(r, idx.event)].filter(Boolean).join(" ");
    const relayFlag = get(r, idx.type).toLowerCase() === "relay";
    const members: Member[] = [];
    if (relayFlag) {
      for (let n = 1; n <= 8; n++) {
        const f = header.indexOf(`firstname${n}`);
        const l = header.indexOf(`lastname${n}`);
        const b = header.indexOf(`regid${n}`);
        const first = get(r, f);
        const last = get(r, l);
        if (first || last) members.push({ first, last, bib: get(r, b) || null });
      }
    }
    out.push({
      divisionId: get(r, idx.eventId) || `${get(r, idx.gender)}|${get(r, idx.event)}|${get(r, idx.division)}`,
      divisionName: eventName,
      placeRaw: get(r, idx.place), heatPlaceRaw: get(r, idx.heatPlace), heatRaw: get(r, idx.heat), roundRaw: get(r, idx.round),
      bib: get(r, idx.bib),
      first: relayFlag ? "" : get(r, idx.first), last: relayFlag ? "" : get(r, idx.last),
      gender: get(r, idx.g1) || get(r, idx.gender), grade: get(r, idx.grade), team: get(r, idx.team),
      mark: get(r, idx.result), splits: [], seededRaw: get(r, idx.seed), statusRaw: get(r, idx.status),
      members, relayFlag,
      teamId: get(r, idx.teamId), athleteId: get(r, idx.athleteId), seedMark: get(r, idx.seedMark), wind: get(r, idx.wind),
      finalFlag: idx.final >= 0 ? /^(y|yes|true|1|final)$/i.test(get(r, idx.final)) : null,
      pb: get(r, idx.pb), sb: get(r, idx.sb), ref: get(r, idx.ref), desig: get(r, idx.desig), region: get(r, idx.region),
      splitByEvent: idx.eventId >= 0 && idx.final >= 0,
    });
  }
  return out;
}

function parseStatus(...raws: string[]): SourceStatus | null {
  for (const raw of raws) {
    const t = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (["DNS", "SCR", "NS", "SCRATCH"].includes(t)) return "DNS";
    if (["DNF"].includes(t)) return "DNF";
    if (["DQ", "DSQ", "FS"].includes(t)) return "DQ";
    if (["NH", "ND", "NM", "FOUL", "FOULS"].includes(t)) return "NM";
  }
  return null;
}

function parsePlace(raw: string): number | null {
  const n = Number(raw.replace(/^[tT]/, "").replace(/[^0-9]/g, ""));
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 && /\d/.test(raw) ? n : null;
}

// MARK: - Normalization

type Entry = {
  key: string;
  raw: RawRow;
  div: DivInfo;
  status: SourceStatus | null;
  overall: number | null;
  heatPlace: number | null;
  heat: number | null;
  mark: string;
  resolved: boolean;
  seeded: number | null;
};

/** Parses a raw feed and normalizes every row: event, round, heat, overall place, seeded count and completeness. */
export function normalizeFeed(meetId: string, feed: RawFeed, meetFinal: boolean, now: number, eventMap: Record<string, string> = {}): NormalizeOutput {
  const text = feed.results.trim();
  const events = parseEvents(feed.events);
  const listedEvents = [...events.entries()].filter(([, name]) => eventMap[name] !== "IGNORE").map(([id]) => id);
  if (!text) return { rows: [], unknownEvents: [], format: "empty", listedEvents };
  const roster = parseRoster(feed.roster);
  let raws: RawRow[];
  let format: NormalizeOutput["format"];
  if (text.split(/\r?\n/).some((l) => l.trim().startsWith("%"))) {
    raws = parseGeneric(text, roster, events);
    format = "generic";
  } else {
    const rows = parseCsv(text);
    const header = (rows[0] ?? []).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (!header.includes("event") || !(header.includes("result") || header.includes("mark") || header.includes("time"))) {
      throw new SourceError("Results feed format wasn't recognized (expected AthleticLIVE generic format or a column-headed results CSV).", "format");
    }
    raws = parseColumns(rows);
    format = "columns";
  }

  const unknown = new Map<string, { sourceEventId: string; eventName: string; rows: number }>();
  const groups = new Map<string, Entry[]>();
  for (const raw of raws) {
    const override = eventMap[raw.divisionName];
    if (override === "IGNORE") continue;
    const div = parseDivision(raw.divisionName);
    if (override) {
      div.event = EVENT_NAMES.find((n) => keyOf(n) === keyOf(override)) ?? null;
      div.relay = div.event ? eventInfo(div.event).relay : div.relay;
    }
    if (raw.heatRaw) div.heat = parsePlace(raw.heatRaw);
    if (raw.heatRaw) div.compiled = false;
    if (/prelim|trial|semi/i.test(raw.roundRaw)) div.round = "PRELIM";
    const gender = div.gender ?? genderFrom(raw.gender);
    div.gender = gender;
    if (raw.relayFlag) div.relay = true;
    if (!div.event) {
      const u = unknown.get(raw.divisionName) ?? { sourceEventId: raw.divisionId, eventName: raw.divisionName, rows: 0 };
      u.rows++;
      unknown.set(raw.divisionName, u);
    }
    const ident = div.relay
      ? `r${normSchool(raw.team)}${raw.desig ? `~${norm(raw.desig)}` : ""}`
      : raw.athleteId ? `a${raw.athleteId}` : raw.bib ? `b${raw.bib}` : `n${norm(raw.first + raw.last)}|${normSchool(raw.team)}`;
    const status = parseStatus(raw.statusRaw, raw.placeRaw, raw.mark);
    const place = parsePlace(raw.placeRaw);
    const explicitHeatPlace = parsePlace(raw.heatPlaceRaw);
    const gk = `${gender ?? "X"}|${div.event ?? `?${raw.divisionName}`}|${div.round}${raw.splitByEvent ? `|${raw.divisionId}` : ""}`;
    const list = groups.get(gk) ?? [];
    list.push({
      key: `${meetId}|${gk}|${ident}`,
      raw, div, status,
      overall: format === "columns" ? place : div.compiled ? place : null,
      heatPlace: format === "columns" ? explicitHeatPlace : div.compiled ? null : place,
      heat: div.heat,
      mark: status ? "" : raw.mark,
      resolved: status !== null || place !== null || explicitHeatPlace !== null,
      seeded: parsePlace(raw.seededRaw),
    });
    groups.set(gk, list);
  }

  const rows: NormalizedMeetResult[] = [];
  for (const [gk, list] of groups) {
    const merged = new Map<string, Entry>();
    for (const e of list) {
      const prev = merged.get(e.key);
      if (!prev) { merged.set(e.key, { ...e }); continue; }
      prev.overall = prev.overall ?? e.overall;
      prev.heatPlace = prev.heatPlace ?? e.heatPlace;
      prev.heat = prev.heat ?? e.heat;
      prev.status = prev.status ?? e.status;
      prev.mark = prev.mark || e.mark;
      prev.resolved = prev.resolved || e.resolved;
      prev.seeded = prev.seeded ?? e.seeded;
      if (e.raw.members.length > prev.raw.members.length) prev.raw = e.raw;
    }
    const entries = [...merged.values()];
    const heatsOnly = entries.every((e) => !e.div.compiled);
    // When the source states official/final per event, that decides; otherwise every row must be resolved.
    const flags = entries.map((e) => e.raw.finalFlag ?? null);
    const explicit = flags.length > 0 && flags.every((f) => f !== null);
    const sourceFinal = explicit ? flags.every((f) => f === true) : null;
    const complete = meetFinal || (explicit ? sourceFinal === true : entries.every((e) => e.resolved) && !heatsOnly);
    const heatCount = new Set(entries.filter((e) => e.status !== "DNS").map((e) => e.heat ?? 0)).size;
    const first = entries[0]?.raw;
    const compKey = first?.splitByEvent
      ? `${gk.split("|")[0]}|${keyOf(first.divisionName.replace(/\b(prelim\w*|finals?|semi\w*|trials?|heats?)\b/gi, ""))}`
      : `${gk.split("|")[0]}|${gk.split("|")[1]}`;
    const heatDone = new Map<string, boolean>();
    for (const e of entries) {
      const hk = String(e.heat ?? "all");
      heatDone.set(hk, (heatDone.get(hk) ?? true) && e.resolved);
    }
    const kind = eventInfo(gk.split("|")[1] ?? "").kind;
    const needsCompile = entries.some((e) => e.overall === null && e.status === null);
    if (complete && needsCompile) {
      const ranked = entries
        .filter((e) => e.status === null)
        .map((e) => ({ e, v: parseMark(e.mark, kind) }))
        .filter((x): x is { e: Entry; v: number } => x.v !== null)
        .sort((a, b) => (kind === "time" ? a.v - b.v : b.v - a.v));
      let lastV: number | null = null;
      let lastPlace = 0;
      ranked.forEach((x, i) => {
        const place = lastV !== null && Math.abs(x.v - lastV) < 1e-9 ? lastPlace : i + 1;
        if (x.e.overall === null) x.e.overall = place;
        lastV = x.v;
        lastPlace = place;
      });
    }
    const seededExplicit = Math.max(0, ...entries.map((e) => e.seeded ?? 0));
    // Field size = valid competitors across the whole event (every heat/flight), scratches (DNS) excluded.
    const seeded = seededExplicit > 0 ? seededExplicit : entries.filter((e) => e.status !== "DNS").length;
    const liveRank = new Map<string, number>();
    if (!complete) {
      const ranked = entries
        .filter((e) => e.status === null)
        .map((e) => ({ e, v: parseMark(e.mark, kind) }))
        .filter((x): x is { e: Entry; v: number } => x.v !== null)
        .sort((a, b) => (kind === "time" ? a.v - b.v : b.v - a.v));
      ranked.forEach((x, i) => liveRank.set(x.e.key, i + 1));
    }
    for (const e of entries) {
      const r = e.raw;
      rows.push({
        id: e.key,
        meetId,
        sourceEventId: r.divisionId,
        eventName: r.divisionName,
        event: e.div.event,
        relay: e.div.relay,
        gender: e.div.gender,
        round: e.div.round,
        raceId: e.heat !== null ? `${r.divisionId}#${e.heat}` : r.divisionId,
        heat: e.heat,
        athleteSourceId: r.athleteId || r.bib || null,
        bib: r.bib || null,
        athleteName: e.div.relay ? r.team : `${r.first} ${r.last}`.trim(),
        firstName: r.first,
        lastName: r.last,
        school: r.team,
        grade: r.grade,
        place: complete ? e.overall : null,
        heatPlace: e.heatPlace,
        livePlace: complete ? e.overall : liveRank.get(e.key) ?? null,
        mark: e.mark,
        splits: r.splits,
        resultStatus: e.status ?? "OK",
        seededCount: seeded,
        completeness: !complete ? "LIVE" : e.div.round === "PRELIM" ? "PRELIM" : "FINAL",
        heatComplete: complete || (heatDone.get(String(e.heat ?? "all")) ?? false),
        relayMembers: r.members,
        timestamp: now,
        sourceAthleteId: r.athleteId || null,
        teamId: r.teamId || null,
        seedMark: r.seedMark ?? "",
        wind: r.wind ?? "",
        srcPb: r.pb ?? "",
        srcSb: r.sb ?? "",
        sourceRef: r.ref ?? "",
        region: r.region ?? "",
        compKey,
        relayDesig: r.desig ?? "",
        heats: heatCount,
        sourceFinal,
      });
    }
  }
  return { rows, unknownEvents: [...unknown.values()], format, listedEvents };
}
