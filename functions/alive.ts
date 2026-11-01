/**
 * AthleticLIVE source adapter: public meet URL → verified meet → real events, athletes and results.
 *
 * AthleticLIVE meet pages (live.athletic.net, *.anet.live, white-label timer hosts) are a JavaScript app. The page itself
 * loads its data from two public, read-only stores, and this adapter reads the same records the page shows:
 *   - meet record + event list:   trackmeet-io.firebaseio.com  meet_list/<id>, meet_<id>/event_summary
 *   - per-event results:          athleticlive.blob.core.windows.net  ind_res_list|rel_res_list/_doc/<eventId>
 *   - per-round fallback:         trackmeet-io.firebaseio.com  meet_<id>/byRoundResults/<roundId>
 * Every result document is checked to belong to the requested meet (its own meetId field) before it is used.
 * Nothing is estimated: rows the source doesn't publish are reported as missing, never filled in.
 *
 * Output is a column-headed results CSV that the shared normalizer already reads, so live scoring, Test Connection and
 * the Test Lab all go through exactly the same parsing, placement and scoring code.
 */
import { fetchAthleticLive, getText, resolveMeetLink, SourceError, type Meet, type RawFeed } from "./meets";

const FB = "https://trackmeet-io.firebaseio.com";
const BLOB = "https://athleticlive.blob.core.windows.net/$web";
const UA = "FantasyTF-LiveScoring/2.0 (+results import)";

export type AliveMeta = {
  id: string; name: string; date: string; endDate: string | null; location: string; region: string; timezone: string;
  sport: string; timer: string; slug: string; updatedAt: string | null; hasResults: boolean; hasHeats: boolean; hasEntries: boolean;
  athleticNetMeets: { id: number; url: string }[];
};

export type SourceStep = { name: string; url: string; ok: boolean; note: string };

export type AliveCapabilities = {
  events: number; eventsWithResults: number; individualEvents: number; relayEvents: number; fieldEvents: number; runningEvents: number;
  combinedSkipped: number; cancelled: number; resultRows: number; athletes: number; teams: number; heats: boolean; flights: boolean;
  overallPlaces: boolean; heatPlaces: boolean; seeds: boolean; wind: boolean; pbSb: boolean; fieldAttempts: boolean; relayLegs: boolean;
  athleteIds: boolean; schools: boolean; schedule: boolean; finalEvents: number; liveEvents: number;
};

export type AliveImport = {
  feed: RawFeed;
  meta: AliveMeta;
  resolvedUrl: string;
  steps: SourceStep[];
  caps: AliveCapabilities;
  /** Result documents refused because they belong to a different meet. */
  rejected: string[];
  /** Events whose results couldn't be read (with the reason). */
  missing: { event: string; why: string }[];
  /** Source document behind each result row (for the Test Lab's raw-source view). */
  raw: Record<string, unknown>;
  method: "event-documents" | "round-documents" | "mixed";
};

type Json = Record<string, unknown>;

/** Test Lab fault injection: exercises the real retry / failure paths without touching AthleticLIVE. */
export type Fault = "timeout" | "5xx" | "empty" | "incomplete";

class NotFound extends Error {}

async function getJson(url: string, tries = 3, fault?: Fault | null): Promise<unknown> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    if (fault === "timeout" || fault === "5xx" || fault === "empty") {
      last = fault === "timeout" ? "timed out" : fault === "5xx" ? "HTTP 503" : "empty response";
      await new Promise((res) => setTimeout(res, 50));
      continue;
    }
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 404) throw new NotFound(url);
      if (r.status >= 500 || r.status === 429) { last = `HTTP ${r.status}`; await new Promise((res) => setTimeout(res, 350 * (i + 1))); continue; }
      if (!r.ok) throw new SourceError(`AthleticLIVE returned HTTP ${r.status}.`, "unreachable");
      const text = await r.text();
      if (!text.trim()) { last = "empty response"; await new Promise((res) => setTimeout(res, 350 * (i + 1))); continue; }
      return JSON.parse(text) as unknown;
    } catch (e) {
      if (e instanceof NotFound || e instanceof SourceError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/subrequest/i.test(msg)) throw new SourceError("Too many source requests in one run.", "unreachable");
      last = e instanceof Error && e.name === "TimeoutError" ? "timed out" : e instanceof SyntaxError ? "unreadable response" : "network error";
      await new Promise((res) => setTimeout(res, 350 * (i + 1)));
    }
  }
  throw new SourceError(`AthleticLIVE is temporarily unavailable (${last}). Existing results are kept; retry shortly.`, "unreachable");
}

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v)).trim();
const csv = (v: unknown): string => {
  const t = s(v).replace(/[\r\n]+/g, " ");
  return /[",]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** True for hosts that serve AthleticLIVE meet pages (official and white-label timer sites). */
export function isAliveHost(host: string): boolean {
  return /(^|\.)live\.athletic\.net$|\.anet\.live$|^anet\.live$|(^|\.)athletic\.live$|^live\.|\.live$/.test(host.toLowerCase());
}

/** Finds the AthleticLIVE meet id behind any public meet link (follows short links like fatl.anet.live/js4pli). */
export async function resolveAliveUrl(raw: string): Promise<{ meetId: string | null; finalUrl: string; steps: SourceStep[] }> {
  const steps: SourceStep[] = [];
  let url: URL;
  try {
    url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
  } catch {
    return { meetId: null, finalUrl: raw, steps: [{ name: "Link", url: raw, ok: false, note: "Not a valid web address." }] };
  }
  const direct = url.pathname.match(/\/meets?\/(\d{2,9})(?:\/|$)/i)?.[1] ?? null;
  if (direct) {
    steps.push({ name: "Meet link", url: url.toString(), ok: true, note: `Meet number ${direct} read from the link.` });
    return { meetId: direct, finalUrl: url.toString(), steps };
  }
  try {
    const r = await fetch(url.toString(), { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    const finalUrl = r.url || url.toString();
    const fromUrl = new URL(finalUrl).pathname.match(/\/meets?\/(\d{2,9})(?:\/|$)/i)?.[1] ?? null;
    if (fromUrl) {
      steps.push({ name: "Short link", url: url.toString(), ok: true, note: `Redirected to ${finalUrl}` });
      return { meetId: fromUrl, finalUrl, steps };
    }
    const body = r.ok ? (await r.text()).slice(0, 400_000) : "";
    const ids = [...new Set([...body.matchAll(/\/meets\/(\d{3,9})\b/g)].map((m) => m[1] as string))];
    if (ids.length === 1) {
      steps.push({ name: "Page", url: finalUrl, ok: true, note: `The page links to exactly one meet (${ids[0]}).` });
      return { meetId: ids[0] as string, finalUrl, steps };
    }
    steps.push({ name: "Page", url: finalUrl, ok: false, note: ids.length > 1 ? "The page lists several meets. Open the meet itself and copy that link." : `No AthleticLIVE meet number found (HTTP ${r.status}).` });
    return { meetId: null, finalUrl, steps };
  } catch {
    steps.push({ name: "Link", url: url.toString(), ok: false, note: "The link couldn't be opened (network error or timeout)." });
    return { meetId: null, finalUrl: url.toString(), steps };
  }
}

function readMeta(id: string, m: Json): AliveMeta {
  const anis = Array.isArray(m.anis) ? (m.anis as Json[]) : [];
  return {
    id, name: s(m.n) || s(m.ln), date: s(m.sdy) || s(m.sd).slice(0, 10), endDate: s(m.ed).slice(0, 10) || null,
    location: s(m.lo), region: [s(m.ls), s(m.lsa)].filter(Boolean).join(", "), timezone: s(m.tz), sport: s(m.o),
    timer: s(m.tna) || s(m.li), slug: s(m.us), updatedAt: s(m.ua) || null, hasResults: m.hr === true, hasHeats: m.hh === true, hasEntries: m.he === true,
    athleticNetMeets: anis.map((a) => ({ id: Number(a.ani ?? 0), url: s(a.u) })).filter((a) => a.id > 0),
  };
}

/** Reads the verified meet record. Throws a clear error when the meet doesn't exist on AthleticLIVE. */
export async function aliveMeta(meetId: string, steps: SourceStep[] = [], fault?: Fault | null): Promise<AliveMeta> {
  let m: Json | null = null;
  try {
    m = (await getJson(`${FB}/meet_list/${meetId}.json`, 3, fault === "incomplete" ? null : fault)) as Json | null;
    steps.push({ name: "Meet record", url: `${FB}/meet_list/${meetId}.json`, ok: !!m, note: m ? "Found." : "Not in the live meet list." });
  } catch (e) {
    steps.push({ name: "Meet record", url: `${FB}/meet_list/${meetId}.json`, ok: false, note: e instanceof Error ? e.message : "unavailable" });
  }
  if (!m) {
    try {
      const doc = (await getJson(`${BLOB}/live_results_meet_list/_doc/${meetId}`, 3, fault === "incomplete" ? null : fault)) as { _source?: Json };
      m = doc._source ?? null;
      steps.push({ name: "Meet archive record", url: `${BLOB}/live_results_meet_list/_doc/${meetId}`, ok: !!m, note: m ? "Found." : "Missing." });
    } catch (e) {
      steps.push({ name: "Meet archive record", url: `${BLOB}/live_results_meet_list/_doc/${meetId}`, ok: false, note: e instanceof NotFound ? "Not found." : e instanceof Error ? e.message : "unavailable" });
      if (!(e instanceof NotFound)) throw e;
    }
  }
  if (!m && fault && fault !== "incomplete") throw new SourceError("AthleticLIVE is temporarily unavailable. Existing results are kept; retry shortly.", "unreachable");
  if (!m) throw new SourceError(`AthleticLIVE has no meet number ${meetId}. Check the link.`, "config");
  if (s(m.i) && s(m.i) !== meetId) throw new SourceError(`The meet record returned belongs to meet ${s(m.i)}, not ${meetId}. Nothing was imported.`, "format");
  return readMeta(meetId, m);
}

const HEADER = [
  "Type", "Event", "EventId", "Round", "Heat", "HeatPlace", "Place", "Result", "Team", "TeamId", "Bib", "AthleteId",
  "FirstName1", "LastName1", "Grade1", "Gender1", "RegId1", "FirstName2", "LastName2", "RegId2", "FirstName3", "LastName3", "RegId3",
  "FirstName4", "LastName4", "RegId4", "Status", "SeedMark", "Wind", "PR", "SR", "Final", "SourceRef", "Relay", "Region",
];

const athleteId = (a: Json): string => (Number(a.ani ?? 0) > 0 ? `anet:${s(a.ani)}` : "");
const teamId = (t: Json): string => (Number(t.ani ?? 0) > 0 ? `anet:${s(t.ani)}` : s(t.i) ? `alive:${s(t.i)}` : "");
const roundLabel = (ev: Json): string => (s(ev.ru) === "P" ? "Prelims" : s(ev.ru) === "F" ? "Finals" : s(ev.rus) || "");
const isMarkless = (row: Json): boolean => !/\d/.test(s(row.m)) || s(row.p) === "--" || row.vm === 0;

/**
 * Imports one AthleticLIVE meet. Reads every scored event (the complete field: every school, every heat/flight), so
 * field size and placements are real. Cornwall Central filtering happens later, at athlete matching.
 */
export async function aliveImport(meetId: string, opts: { resolvedUrl?: string; steps?: SourceStep[]; fault?: Fault | null } = {}): Promise<AliveImport> {
  const steps = opts.steps ?? [];
  const fault = opts.fault ?? null;
  const meta = await aliveMeta(meetId, steps, fault);
  let summary: Record<string, Json> | null = null;
  try {
    summary = (await getJson(`${FB}/meet_${meetId}/event_summary.json`)) as Record<string, Json> | null;
    steps.push({ name: "Event list", url: `${FB}/meet_${meetId}/event_summary.json`, ok: !!summary, note: summary ? `${Object.keys(summary).length} events.` : "No events published." });
  } catch (e) {
    steps.push({ name: "Event list", url: `${FB}/meet_${meetId}/event_summary.json`, ok: false, note: e instanceof Error ? e.message : "unavailable" });
    throw e;
  }
  const events = Object.values(summary ?? {}).filter((e) => e && typeof e === "object");
  const caps: AliveCapabilities = {
    events: events.length, eventsWithResults: 0, individualEvents: 0, relayEvents: 0, fieldEvents: 0, runningEvents: 0, combinedSkipped: 0,
    cancelled: 0, resultRows: 0, athletes: 0, teams: 0, heats: false, flights: false, overallPlaces: false, heatPlaces: false, seeds: false,
    wind: false, pbSb: false, fieldAttempts: false, relayLegs: false, athleteIds: false, schools: false, schedule: false, finalEvents: 0, liveEvents: 0,
  };
  const rows: string[] = [HEADER.join(",")];
  const eventsCsv: string[] = [];
  const raw: Record<string, unknown> = {};
  const rejected: string[] = [];
  const missing: { event: string; why: string }[] = [];
  const athletes = new Set<string>();
  const teams = new Set<string>();
  let usedDocs = 0;
  let usedRounds = 0;
  let docsBlocked = false;

  const scored = events.filter((e) => {
    if (e.ccl === true || s(e.es) === "ca") { caps.cancelled++; return false; }
    if (s(e.ec) === "Combined") { caps.combinedSkipped++; return false; }
    // Pentathlon/heptathlon/decathlon component events ("Girls Outdoor Pentathlon 100m Hurdles") are parts of one
    // combined competition, not standalone events: never scored as separate results (a hurdles time is not a pentathlon score).
    if (/athlon/i.test(s(e.n))) {
      caps.combinedSkipped++;
      missing.push({ event: s(e.n), why: "Combined-event component: not scored as a separate event (the verified combined total isn't published as its own result)." });
      return false;
    }
    return s(e.ec) === "Individual" || s(e.ec) === "Relay";
  });
  for (const e of scored) eventsCsv.push([csv(e.i), csv(e.n), "", "", csv(meta.date), ""].join(","));

  const emit = (ev: Json, row: Json, relay: boolean, docRef: string): void => {
    const a = (row.a ?? {}) as Json;
    const t = ((relay ? row.t : a.t) ?? {}) as Json;
    const team = s(t.n) || s(t.f) || s(row.tn);
    const tid = teamId(t);
    if (tid) teams.add(tid); else if (team) teams.add(team);
    const field = s(ev.peg) === "Field" || Array.isArray(row.hs) || Array.isArray(row.vs);
    const heat = s(row.hn);
    const place = /^\d+$/.test(s(row.p)) ? s(row.p) : "";
    const heatPlace = /^\d+$/.test(s(row.hl)) ? s(row.hl) : "";
    const status = isMarkless(row) ? s(row.m).toUpperCase() || "DNS" : "";
    if (place) caps.overallPlaces = true;
    if (heatPlace) caps.heatPlaces = true;
    if (s(row.s)) caps.seeds = true;
    if (s(row.w)) caps.wind = true;
    if (s(row.pr) || s(row.er)) caps.pbSb = true;
    if (Array.isArray(row.hs) || Array.isArray(row.vs)) caps.fieldAttempts = true;
    if (Number(heat) > 1) { if (field) caps.flights = true; else caps.heats = true; }
    const members = relay && Array.isArray(row.rm) ? (row.rm as Json[]).map((m) => (m.a ?? {}) as Json) : [];
    if (members.length > 0) caps.relayLegs = true;
    let first = s(a.fn);
    let last = s(a.l);
    if (!relay && !first && !last && s(a.n || row.n)) {
      const parts = s(a.n || row.n).split(/\s+/);
      first = parts[0] ?? "";
      last = parts.slice(1).join(" ");
    }
    const aid = relay ? "" : athleteId(a);
    if (aid) caps.athleteIds = true;
    if (team) caps.schools = true;
    if (!relay) athletes.add(aid || `${first} ${last}|${team}`);
    for (const m of members) athletes.add(athleteId(m) || `${s(m.fn)} ${s(m.l)}|${team}`);
    const ref = `${docRef}#${s(row.i)}`;
    raw[ref] = row;
    const mem = (i: number): string[] => {
      const m = members[i];
      if (!m) return ["", "", ""];
      return [csv(m.fn), csv(m.l), csv(athleteId(m) || (s(m.cm) ? `bib:${s(m.cm)}` : ""))];
    };
    const indiv = relay ? ["", "", "", ""] : [csv(first), csv(last), csv(a.y ?? row.y), csv(a.g)];
    const relayCols = relay ? [...mem(0).slice(0, 2), "", "", mem(0)[2] as string] : [...indiv, ""];
    rows.push([
      relay ? "Relay" : "Individual", csv(ev.n), csv(ev.i), csv(roundLabel(ev)), csv(heat), heatPlace, place, csv(status ? "" : row.m), csv(team), csv(tid),
      csv(relay ? "" : s(a.cm ?? row.cm)), csv(aid),
      ...relayCols, ...mem(1), ...mem(2), ...mem(3),
      csv(status), csv(row.s), csv(row.w), csv(row.pr), csv(row.er), ev.ifi === true ? "Y" : "N", csv(ref), csv(relay ? row.rd : ""), csv(meta.region),
    ].join(","));
    caps.resultRows++;
  };

  const queue = scored.filter((e) => e.hr === true);
  caps.eventsWithResults = queue.length;
  for (const e of scored) {
    if (s(e.ec) === "Relay") caps.relayEvents++; else caps.individualEvents++;
    if (s(e.peg) === "Field") caps.fieldEvents++; else if (s(e.ec) !== "Relay") caps.runningEvents++;
    if (e.hr === true) { if (e.ifi === true) caps.finalEvents++; else caps.liveEvents++; }
  }
  for (const e of scored.filter((x) => x.hr !== true)) missing.push({ event: s(e.n), why: "No results posted yet." });

  const byRound = async (ev: Json): Promise<boolean> => {
    const rui = s(ev.rui);
    if (!rui) return false;
    try {
      const data = (await getJson(`${FB}/meet_${meetId}/byRoundResults/${encodeURIComponent(rui)}.json`)) as Record<string, Json> | null;
      if (!data) return false;
      const relay = s(ev.ec) === "Relay";
      for (const row of Object.values(data)) {
        const r: Json = relay
          ? { ...row, t: { n: row.n } }
          : { ...row, a: { n: row.n, fn: row.fn, l: row.l, y: row.y, cm: row.cm, ani: row.ani, t: { n: row.tn } } };
        emit(ev, r, relay, `byRoundResults/${rui}`);
      }
      usedRounds++;
      return true;
    } catch {
      return false;
    }
  };

  const work = [...queue];
  let n = 0;
  const worker = async (): Promise<void> => {
    for (let ev = work.shift(); ev; ev = work.shift()) {
      const relay = s(ev.ec) === "Relay";
      const doc = `${relay ? "rel_res_list" : "ind_res_list"}/_doc/${s(ev.i)}`;
      // Simulated partial outage: every other event's results are unreadable.
      if (fault === "incomplete" && n++ % 2 === 1) { missing.push({ event: s(ev.n), why: "Result data temporarily unreadable (simulated outage)." }); continue; }
      if (!docsBlocked) {
        try {
          const d = (await getJson(`${BLOB}/${doc}`, 2)) as { _source?: Json };
          const src = d._source ?? {};
          if (s(src.mi) && s(src.mi) !== meetId) {
            rejected.push(`${s(ev.n)}: result document belongs to meet ${s(src.mi)}`);
            continue;
          }
          const list = (relay ? src.rts : src.r) as Json[] | undefined;
          if (Array.isArray(list)) {
            const evMerged: Json = { ...ev, ifi: src.ifi ?? ev.ifi, peg: src.peg ?? ev.peg, ru: src.ru ?? ev.ru };
            for (const row of list) emit(evMerged, row, relay, doc);
            usedDocs++;
            continue;
          }
        } catch (e) {
          if (e instanceof SourceError && /Too many source requests/.test(e.message)) docsBlocked = true;
        }
      }
      if (!(await byRound(ev))) missing.push({ event: s(ev.n), why: "Results are listed but their result data couldn't be read." });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, Math.max(1, work.length)) }, () => worker()));

  caps.athletes = athletes.size;
  caps.teams = teams.size;
  steps.push({
    name: "Results", url: `${BLOB}/ind_res_list/_doc/<eventId>`, ok: caps.resultRows > 0,
    note: `${caps.resultRows} result rows from ${usedDocs} event documents${usedRounds ? ` and ${usedRounds} round documents` : ""}${missing.length ? `; ${missing.length} events without readable results` : ""}${rejected.length ? `; ${rejected.length} documents refused (other meet)` : ""}.`,
  });
  return {
    feed: { events: eventsCsv.join("\n"), roster: "", results: caps.resultRows > 0 ? rows.join("\n") : "" },
    meta, resolvedUrl: opts.resolvedUrl ?? "", steps, caps, rejected, missing, raw,
    method: usedRounds === 0 ? "event-documents" : usedDocs === 0 ? "round-documents" : "mixed",
  };
}

/**
 * A re-read that lost rows the last good copy had (events listed as having results but unreadable) is a temporary
 * outage, not a correction: the caller keeps the last complete copy and retries.
 */
export function incompleteImport(imp: AliveImport, prevRows: number): string | null {
  const unreadable = imp.missing.filter((m) => !/No results posted yet/.test(m.why));
  if (unreadable.length === 0 || prevRows <= 0 || imp.caps.resultRows >= prevRows) return null;
  return `AthleticLIVE returned incomplete results (${imp.caps.resultRows} of ${prevRows} rows; ${unreadable.length} events unreadable). The last complete copy is kept; retrying.`;
}

/** Outcome of checking a pasted meet link. `ok` only when real result rows were read from a verified source. */
export type SourceCheck = {
  ok: boolean; kind: "athleticlive" | "alive-folder" | "invalid"; message: string; meetId: string | null; meta: AliveMeta | null;
  steps: SourceStep[]; warnings: string[]; eventsUrl: string; rosterUrl: string; resultsUrl: string;
};

const DAY = 86_400_000;

/**
 * Meet identity check that never relies on which schools appear: the source's own meet id must match, and when the
 * commissioner entered a date it must fall within the source meet's dates (±3 days for multi-day / rescheduled meets).
 */
export function verifyMeet(meta: AliveMeta, expect: { date?: string; name?: string }): { ok: boolean; problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (expect.date && meta.date) {
    const want = Date.parse(`${expect.date}T12:00:00Z`);
    const start = Date.parse(`${meta.date}T12:00:00Z`);
    const end = Date.parse(`${meta.endDate ?? meta.date}T12:00:00Z`);
    if (Number.isFinite(want) && Number.isFinite(start) && (want < start - 3 * DAY || want > end + 3 * DAY)) {
      problems.push(`The AthleticLIVE meet "${meta.name}" is dated ${meta.date}, but this meet is set for ${expect.date}. Check the link or the meet date.`);
    }
  }
  if (!meta.hasResults) warnings.push("AthleticLIVE hasn't posted results for this meet yet.");
  return { ok: problems.length === 0, problems, warnings };
}

/** Checks a pasted link: AthleticLIVE meet pages first (verified + results actually read), then a timer's data folder. */
export async function checkSource(raw: string, expect: { date?: string; name?: string } = {}): Promise<SourceCheck> {
  const base = { eventsUrl: "", rosterUrl: "", resultsUrl: "", warnings: [] as string[] };
  const r = await resolveAliveUrl(raw);
  if (r.meetId) {
    try {
      const imp = await aliveImport(r.meetId, { resolvedUrl: r.finalUrl, steps: r.steps });
      const v = verifyMeet(imp.meta, expect);
      if (!v.ok) return { ...base, ok: false, kind: "athleticlive", message: v.problems.join(" "), meetId: r.meetId, meta: imp.meta, steps: imp.steps, warnings: v.warnings };
      const rows = imp.caps.resultRows;
      const msg = rows > 0
        ? `Found "${imp.meta.name}" (${imp.meta.date}, ${imp.meta.region}): ${imp.caps.eventsWithResults} events with results, ${rows} results, ${imp.caps.athletes} athletes.`
        : `Found "${imp.meta.name}" (${imp.meta.date}). No results are posted yet, so scoring can't be checked until they are.`;
      return { ...base, ok: true, kind: "athleticlive", message: msg, meetId: r.meetId, meta: imp.meta, steps: imp.steps, warnings: [...v.warnings, ...imp.missing.slice(0, 8).map((m) => `${m.event}: ${m.why}`)] };
    } catch (e) {
      return { ...base, ok: false, kind: "athleticlive", message: e instanceof Error ? e.message : "AthleticLIVE couldn't be read.", meetId: r.meetId, meta: null, steps: r.steps };
    }
  }
  const folder = await resolveMeetLink(raw);
  return {
    ...base, ok: folder.ok, kind: folder.kind === "invalid" ? "invalid" : "alive-folder", message: folder.ok ? folder.message : `${r.steps[r.steps.length - 1]?.note ?? ""} ${folder.message}`.trim(),
    meetId: folder.meetId, meta: null, steps: r.steps, eventsUrl: folder.eventsUrl, rosterUrl: folder.rosterUrl, resultsUrl: folder.resultsUrl,
  };
}

/**
 * The one source reader every path uses (live polling, Test Connection, Test Lab). A verified AthleticLIVE meet is read
 * directly; an Advanced Events / Roster / Results link replaces only its own dataset.
 */
export async function fetchMeetFeed(
  m: Pick<Meet, "eventsUrl" | "rosterUrl" | "resultsUrl"> & { sourceMeetId?: string | null },
  opts: { fault?: Fault | null; steps?: SourceStep[]; resolvedUrl?: string } = {},
): Promise<{ feed: RawFeed; imp: AliveImport | null }> {
  if (m.sourceMeetId) {
    const imp = await aliveImport(m.sourceMeetId, opts);
    const [events, roster, results] = await Promise.all([
      m.eventsUrl.trim() ? getText("Advanced Events", m.eventsUrl) : Promise.resolve(imp.feed.events),
      m.rosterUrl.trim() ? getText("Advanced Roster", m.rosterUrl) : Promise.resolve(imp.feed.roster),
      m.resultsUrl.trim() ? getText("Advanced Results", m.resultsUrl) : Promise.resolve(imp.feed.results),
    ]);
    return { feed: { events, roster, results }, imp };
  }
  return { feed: await fetchAthleticLive(m), imp: null };
}

/**
 * Public link → verified AthleticLIVE import. Fails loudly (never guesses) when the link isn't an AthleticLIVE meet.
 */
export async function discoverMeet(raw: string): Promise<AliveImport> {
  const r = await resolveAliveUrl(raw);
  if (!r.meetId) {
    const why = r.steps[r.steps.length - 1]?.note ?? "No AthleticLIVE meet found at that link.";
    throw new SourceError(`${why} Paste the meet's AthleticLIVE link (…/meets/12345), or use the Advanced links.`, "config");
  }
  return aliveImport(r.meetId, { resolvedUrl: r.finalUrl, steps: r.steps });
}
