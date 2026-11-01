import { DurableObject } from "cloudflare:workers";
import { hashPassword, safeEqual } from "./auth";
import { Db, type DbEnv } from "./db";
import { normalizeName, seedAthletes, type Pos } from "./seed";
import {
  applyMeetFields, blankGlobalMeet, cleanLive, cleanNotices, cleanRoster, cleanSettings, currentRules, defaultConfig, GlobalError, liveRows,
  MAIN_LEAGUE_CODE, mergeTiers, normalizeConfig, OFFICIAL_SEASONS, OFFICIAL_TABLES, setPerformanceRows, setStandardRows, toggleStandardRow, validateTable,
  type GlobalConfig, type MergeNote,
} from "./global";
import { cleanScoring, keyOf, type PerformanceRule, type Standard } from "./scoring";
import { OFFICIAL_TABLES_V2 } from "./tablesV2";
import { applyLifecycle, finalGate, isScheduled, logChange, nextScheduleAt, scheduleTick } from "./schedule";

/** Commissioner-approved (Oct 29 2026): merge the 5-tier tables into 2026–2032, add unseeded brackets, re-score 2026. */
const TABLES_V2_ENABLED = true;
/** Unseeded-section brackets start at 0 points (the commissioner sets the values). */
const UNSEEDED_DEFAULT = [0.05, 0.1, 0.2, 0.3, 0.4].map((pct) => ({ pct, pts: 0 }));
import { normalizeFeed, parseCsv, SourceError, type Meet, type RawFeed } from "./meets";
import { checkSource, fetchMeetFeed, incompleteImport } from "./alive";
import { canonSchool, identityKey, isCornwallName, looseNameMatch, norm, POOL_SCHOOL, sameSchool } from "./names";

type DirEnv = DbEnv & {
  DO: Fetcher & {
    setAlarm(className: string, id: string, scheduledTime: number | Date): Promise<void>;
    deleteAlarm(className: string, id: string): Promise<void>;
  };
};

type GUser = { id: string; name: string };

function fnv(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/** One row of the master athlete list. Identity fields live here; ownership and status stay per league. */
export type MasterAthlete = {
  id: string; name: string; gender: "B" | "G"; positions: Pos[]; flex: boolean; note: string; rank: number; school: string; rev: number;
  status: "active" | "Q" | "O" | "IR"; photoAt: number | null; crop: { x: number; y: number; zoom: number } | null; retired: boolean;
  /** Added by another school's league (Cornwall Central leagues never auto-add these). */
  scoped?: boolean;
};

/** Stage data-check tags. Only "-before" tags take a backup; a tag's backup is written once. */
const INTEGRITY_TAGS = new Set(["stage1-before", "stage1-after", "stage2-before", "stage2-after", "stage3-before", "stage3-after", "stage4-before", "stage4-after"]);

type IntegrityReport = {
  tag: string; at: number; platform: Record<string, number>;
  leagues: { id: string; ref: string; name: string; ok: boolean; counts: Record<string, number | string>; backup: { complete: boolean; counts: Record<string, number | string> | null; at: number; existed: boolean } | null; error?: string }[];
  diff?: { matched: boolean; missingLeagues: string[]; newLeagues: string[]; changes: { ref: string; field: string; before: number | string; after: number | string }[]; platform: { field: string; before: number; after: number }[] };
};

function diffIntegrity(a: IntegrityReport, b: IntegrityReport): NonNullable<IntegrityReport["diff"]> {
  const byA = new Map(a.leagues.map((l) => [l.id, l]));
  const byB = new Map(b.leagues.map((l) => [l.id, l]));
  const changes: NonNullable<IntegrityReport["diff"]>["changes"] = [];
  for (const [id, la] of byA) {
    const lb = byB.get(id);
    if (!lb) continue;
    for (const k of new Set([...Object.keys(la.counts), ...Object.keys(lb.counts)])) {
      if (la.counts[k] !== lb.counts[k]) changes.push({ ref: la.ref, field: k, before: la.counts[k] ?? "", after: lb.counts[k] ?? "" });
    }
  }
  const platform = Object.keys(a.platform).filter((k) => a.platform[k] !== b.platform[k]).map((k) => ({ field: k, before: a.platform[k] ?? 0, after: b.platform[k] ?? 0 }));
  const missingLeagues = [...byA.keys()].filter((id) => !byB.has(id)).map((id) => byA.get(id)?.ref ?? "");
  const newLeagues = [...byB.keys()].filter((id) => !byA.has(id)).map((id) => byB.get(id)?.ref ?? "");
  return { matched: changes.length === 0 && platform.length === 0 && missingLeagues.length === 0, missingLeagues, newLeagues, changes, platform };
}

type ImportRow = { name?: unknown; gender?: unknown; position?: unknown; grade?: unknown; confirmNew?: unknown };

type AthleteRow = {
  id: string; name: string; gender: string; positions: string; flex: number; note: string; rank: number; school: string;
  rev: number; updated_at: number; updated_by: string; status: string; photo_at: number; crop: string; retired: number;
};

type ExportAthlete = {
  id: string; name: string; gender: "B" | "G"; positions: Pos[]; flex: boolean; note?: string; school?: string; rank?: number;
  status?: string; photoAt?: number | null;
};

type LeagueExport = { id: string; name: string; createdAt: number; athletes: ExportAthlete[]; edits: Record<string, number> };

const STATUSES = ["active", "Q", "D", "O", "IR"] as const;
const cleanStatus = (v: unknown): MasterAthlete["status"] => (STATUSES as readonly string[]).includes(String(v)) ? (String(v) as MasterAthlete["status"]) : "active";
const MAX_PHOTO_B64 = 120_000;

const ALL_POS: Pos[] = ["SPR", "DIS", "FLD"];

function cleanPositions(raw: unknown, flex: unknown): { positions: Pos[]; flex: boolean } {
  const list = Array.isArray(raw) ? raw.map(String) : [];
  if (flex === true || list.includes("FLEX")) return { positions: [...ALL_POS], flex: true };
  const valid = [...new Set(list.filter((p): p is Pos => p === "SPR" || p === "DIS" || p === "FLD"))];
  if (valid.length === 0 || valid.length === 3) return { positions: [...ALL_POS], flex: true };
  return { positions: ALL_POS.filter((p) => valid.includes(p)), flex: false };
}

function toMaster(r: AthleteRow): MasterAthlete {
  const pos = cleanPositions(JSON.parse(r.positions || "[]"), r.flex === 1);
  let crop: MasterAthlete["crop"] = null;
  try { crop = r.crop ? (JSON.parse(r.crop) as MasterAthlete["crop"]) : null; } catch { crop = null; }
  return {
    id: r.id, name: r.name, gender: r.gender === "G" ? "G" : "B", positions: pos.positions, flex: pos.flex, note: r.note, rank: r.rank, school: r.school, rev: r.rev,
    status: cleanStatus(r.status), photoAt: r.photo_at ? r.photo_at : null, crop, retired: r.retired === 1,
  };
}

function cleanCrop(raw: unknown): MasterAthlete["crop"] {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { x: n(o.x, 0, 1, 0.5), y: n(o.y, 0, 1, 0.4), zoom: n(o.zoom, 1, 6, 1) };
}

type LeagueRow = { league_id: string; code: string; name: string; created_at: number };

type LinkRow = {
  source_id: string; athlete_id: string; name: string; school: string; gender: string; grade: string; provider: string;
  first_seen: number; last_seen: number; meets: string; conflict: string;
};

function toLink(r: LinkRow): Record<string, unknown> {
  let meets: string[] = [];
  try { meets = JSON.parse(r.meets || "[]") as string[]; } catch { meets = []; }
  return {
    sourceId: r.source_id, athleteId: r.athlete_id, name: r.name, school: r.school, gender: r.gender, grade: r.grade, provider: r.provider,
    firstSeen: r.first_seen, lastSeen: r.last_seen, meets: meets.length, conflict: r.conflict,
  };
}
type AccountRow = {
  id: string; email: string; name: string; hash: string; salt: string; prefs: string;
  created_at: number; failed: number; locked_until: number;
};

export type Prefs = { player: boolean; trades: boolean; waivers: boolean; draft: boolean; live: boolean; league: boolean };
export const DEFAULT_PREFS: Prefs = { player: true, trades: true, waivers: true, draft: true, live: true, league: true };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESET_MS = 20 * 60_000;

function cleanPrefs(raw: unknown): Prefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(out) as (keyof Prefs)[]) if (typeof p[k] === "boolean") out[k] = p[k] as boolean;
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function err(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/** Global singleton: accounts, invite codes → league ids, each user's league memberships, and the master athlete list. */
export class Directory extends DurableObject<DirEnv> {
  private migrating: Promise<void> | null = null;
  private db: Db;

  constructor(ctx: DurableObjectState, env: DirEnv) {
    super(ctx, env);
    this.db = new Db(env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS leagues (
        league_id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        user_id TEXT NOT NULL,
        league_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, league_id)
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        prefs TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS resets (
        email TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        expires INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS athletes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) > 0),
        gender TEXT NOT NULL CHECK (gender IN ('B', 'G')),
        positions TEXT NOT NULL,
        flex INTEGER NOT NULL CHECK (flex IN (0, 1)),
        note TEXT NOT NULL DEFAULT '',
        rank INTEGER NOT NULL,
        school TEXT NOT NULL DEFAULT '',
        rev INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS athletes_rev ON athletes(rev);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hidden (
        user_id TEXT NOT NULL,
        league_id TEXT NOT NULL,
        hidden_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, league_id)
      );
      CREATE TABLE IF NOT EXISTS co_invites (
        code TEXT PRIMARY KEY,
        league_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pool_backup (
        league_id TEXT NOT NULL,
        taken_at INTEGER NOT NULL,
        athletes TEXT NOT NULL,
        PRIMARY KEY (league_id, taken_at)
      );
      CREATE TABLE IF NOT EXISTS league_sync (
        league_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        phase TEXT NOT NULL DEFAULT '',
        shape_pending INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_links (
        source_id TEXT PRIMARY KEY,
        athlete_id TEXT NOT NULL,
        name TEXT NOT NULL,
        school TEXT NOT NULL DEFAULT '',
        gender TEXT NOT NULL DEFAULT '',
        grade TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT 'athleticlive',
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        meets TEXT NOT NULL DEFAULT '[]',
        conflict TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS aliases (
        alias TEXT NOT NULL,
        athlete_id TEXT NOT NULL,
        name TEXT NOT NULL,
        gender TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL,
        PRIMARY KEY (alias, athlete_id)
      );
      CREATE TABLE IF NOT EXISTS push_devices (
        sub_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        onesignal_id TEXT NOT NULL DEFAULT '',
        token_tail TEXT NOT NULL DEFAULT '',
        has_token INTEGER NOT NULL DEFAULT 0,
        permission TEXT NOT NULL DEFAULT '',
        opted_in INTEGER NOT NULL DEFAULT 0,
        environment TEXT NOT NULL DEFAULT '',
        app_version TEXT NOT NULL DEFAULT '',
        device TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS push_devices_user ON push_devices(user_id);
      CREATE TABLE IF NOT EXISTS school_athletes (
        id TEXT PRIMARY KEY,
        school_key TEXT NOT NULL,
        league_id TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pool_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        athlete_id TEXT NOT NULL,
        field TEXT NOT NULL,
        old TEXT NOT NULL,
        new TEXT NOT NULL,
        source TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `);
    // Columns added for the master player database (older Directories get them in place).
    for (const ddl of [
      "ALTER TABLE athletes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
      "ALTER TABLE athletes ADD COLUMN photo_at INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE athletes ADD COLUMN crop TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE athletes ADD COLUMN retired INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE accounts ADD COLUMN pw_changed_at INTEGER NOT NULL DEFAULT 0",
    ]) {
      try { this.ctx.storage.sql.exec(ddl); } catch { /* column already exists */ }
    }
  }

  // MARK: Master athlete list

  private meta(k: string): string | null {
    return this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0]?.v ?? null;
  }

  private setMeta(k: string, v: string): void {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, v);
  }

  /** Global, strictly increasing revision. Every master-list change gets the next number. */
  private nextRev(): number {
    const n = Number(this.meta("pool_rev") ?? "0") + 1;
    this.setMeta("pool_rev", String(n));
    return n;
  }

  private athleteRow(id: string): AthleteRow | undefined {
    return this.ctx.storage.sql.exec<AthleteRow>("SELECT * FROM athletes WHERE id = ?", id).toArray()[0];
  }

  private logChange(athleteId: string, field: string, oldV: string, newV: string, source: string): void {
    this.ctx.storage.sql.exec("INSERT INTO pool_log (athlete_id, field, old, new, source, at) VALUES (?, ?, ?, ?, ?, ?)", athleteId, field, oldV, newV, source, Date.now());
  }

  private leagueFetch(leagueId: string, path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("X-Rork-DO-Class", "League");
    headers.set("X-Rork-DO-Id", leagueId);
    if (init.body) headers.set("Content-Type", "application/json");
    return this.env.DO.fetch(new Request(`https://internal${path}`, { ...init, headers }));
  }

  private mirrorAthletes(rows: MasterAthlete[]): void {
    if (!this.db.enabled || rows.length === 0) return;
    const now = Date.now();
    this.ctx.waitUntil(
      this.db.upsert("td_athletes", rows.map((a) => ({
        id: a.id, name: a.name, gender: a.gender, positions: a.positions, flex: a.flex, school: a.school, note: a.note, rank: a.rank, rev: a.rev, updated_at: now,
      }))).catch((e: unknown) => console.warn("mirror td_athletes failed", String(e))),
    );
  }

  /** Sends master rows to every league. Leagues apply them only if newer (by rev), so repeats are harmless. */
  private fanOut(rows: MasterAthlete[], force = false): void {
    if (rows.length === 0) return;
    const leagues = this.ctx.storage.sql.exec<{ league_id: string }>("SELECT league_id FROM leagues").toArray();
    const body = JSON.stringify({ athletes: rows, force });
    this.ctx.waitUntil((async () => {
      for (const { league_id } of leagues) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await this.leagueFetch(league_id, "/pool-apply", { method: "POST", body });
            if (r.ok || r.status === 404) break;
          } catch (e) {
            console.warn("pool fan-out failed", league_id, String(e));
          }
          await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
        }
      }
    })());
  }

  private allMaster(): MasterAthlete[] {
    return this.tagScoped(this.ctx.storage.sql.exec<AthleteRow>("SELECT * FROM athletes ORDER BY rank").toArray().map(toMaster));
  }

  /** Marks players that were added by another school's league. */
  private tagScoped(rows: MasterAthlete[]): MasterAthlete[] {
    const ids = new Set(this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM school_athletes").toArray().map((r) => r.id));
    if (ids.size === 0) return rows;
    return rows.map((r) => (ids.has(r.id) ? { ...r, scoped: true } : r));
  }

  private async ensurePool(): Promise<void> {
    if (this.meta("pool_v2")) return;
    this.migrating ??= this.buildPool().finally(() => { this.migrating = null; });
    await this.migrating;
  }

  /**
   * One-time: builds the master player database from the Main League's players (the Main League's version wins for
   * every field, including headshots). Every league is backed up first. Differences found in other leagues are only
   * logged for review, never applied. Players that exist only in another league stay in that league untouched.
   */
  private async buildPool(): Promise<void> {
    if (this.meta("pool_v2")) return;
    const mainId = this.mainLeagueId();
    if (!mainId) throw new Error("Main League not found");
    const leagues = this.ctx.storage.sql.exec<{ league_id: string }>("SELECT league_id FROM leagues").toArray();
    const exports = new Map<string, LeagueExport>();
    for (const { league_id } of leagues) {
      try {
        const r = await this.leagueFetch(league_id, "/pool-export?backup=1");
        if (!r.ok) continue;
        const ex = (await r.json()) as LeagueExport;
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO pool_backup (league_id, taken_at, athletes) VALUES (?, ?, ?)", league_id, Date.now(), JSON.stringify(ex.athletes));
        exports.set(league_id, ex);
      } catch (e) {
        console.warn("pool export failed", league_id, String(e));
      }
    }
    const main = exports.get(mainId);
    if (!main) throw new Error("Main League export failed");
    const now = Date.now();
    const ordered = [...main.athletes].sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0));
    let rank = 0;
    for (const a of ordered) {
      const pos = cleanPositions(a.positions, a.flex);
      let photoAt = 0;
      if (a.photoAt) {
        try {
          const r = await this.leagueFetch(mainId, `/athlete-photo?athleteId=${encodeURIComponent(a.id)}&v=${a.photoAt}`);
          if (r.ok) {
            const b64 = bytesToB64(new Uint8Array(await r.arrayBuffer()));
            if (b64.length > 200 && b64.length <= MAX_PHOTO_B64) {
              await this.ctx.storage.put(`mphoto:${a.id}:${a.photoAt}`, b64);
              photoAt = a.photoAt;
            }
          }
        } catch (e) {
          console.warn("master photo copy failed", a.id, String(e));
        }
      }
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO athletes (id, name, gender, positions, flex, note, rank, school, rev, updated_at, updated_by, status, photo_at, crop, retired)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0)`,
        a.id, a.name, a.gender === "G" ? "G" : "B", JSON.stringify(pos.positions), pos.flex ? 1 : 0, a.note ?? "", rank++, a.school ?? "",
        this.nextRev(), now, "main-league", cleanStatus(a.status), photoAt,
      );
    }
    this.logChange("*", "built", "", String(ordered.length), `master built from the Main League (${MAIN_LEAGUE_CODE})`);
    const master = new Map(this.allMaster().map((m) => [m.id, m]));
    const posKey = (p: { positions: Pos[]; flex: boolean }): string => (p.flex ? "FLEX" : ALL_POS.filter((x) => p.positions.includes(x)).join("/"));
    let logged = 0;
    for (const [id, ex] of exports) {
      if (id === mainId) continue;
      for (const a of ex.athletes) {
        if (logged > 3000) break;
        const m = master.get(a.id);
        const src = `${ex.name}: differs from the Main League (Main League kept)`;
        if (!m) { this.logChange(a.id, "league-only", "", a.name, `${ex.name}: player not in the Main League (kept only in that league)`); logged++; continue; }
        const pos = cleanPositions(a.positions, a.flex);
        const diffs: [string, string, string][] = [];
        if (a.name !== m.name) diffs.push(["name", m.name, a.name]);
        if ((a.school ?? "") !== m.school) diffs.push(["school", m.school, a.school ?? ""]);
        if (a.gender !== m.gender) diffs.push(["gender", m.gender, a.gender]);
        if (posKey(pos) !== posKey(m)) diffs.push(["positions", posKey(m), posKey(pos)]);
        if (cleanStatus(a.status) !== m.status) diffs.push(["status", m.status, cleanStatus(a.status)]);
        if (!!a.photoAt !== !!m.photoAt) diffs.push(["photo", m.photoAt ? "has photo" : "no photo", a.photoAt ? "has photo" : "no photo"]);
        for (const [f, o, n] of diffs) { this.logChange(a.id, f, o, n, src); logged++; }
      }
    }
    this.setMeta("pool_v2", String(now));
    this.setMeta("pool_migrated", String(now));
    this.setMeta("pool_migrated_leagues", String(exports.size));
    const all = this.allMaster();
    this.mirrorAthletes(all);
    this.fanOut(all, true);
  }

  /** Validates a position assignment ("SPR/DIS", "FLEX", or a list). Unknown values are rejected, never collapsed. */
  private parsePositions(code: unknown, list: unknown): { positions: Pos[]; flex: boolean } | null {
    const raw = typeof code === "string" && code.trim() ? code.split(/[\/,+ ]+/) : Array.isArray(list) ? list.map(String) : [];
    const tokens = raw.map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (tokens.length === 0) return null;
    if (tokens.some((t) => !["SPR", "DIS", "FLD", "FLEX"].includes(t))) throw new GlobalError(`Unknown position: ${tokens.join(", ")}.`);
    return cleanPositions(tokens, tokens.includes("FLEX"));
  }

  private saveMaster(next: MasterAthlete, prevRev: number | null, by: GUser): MasterAthlete {
    const rev = this.nextRev();
    const vals = [
      next.name, next.gender, JSON.stringify(next.positions), next.flex ? 1 : 0, next.note, next.rank, next.school, rev, Date.now(), by.id,
      next.status, next.photoAt ?? 0, next.crop ? JSON.stringify(next.crop) : "", next.retired ? 1 : 0,
    ];
    if (prevRev === null) {
      this.ctx.storage.sql.exec(
        `INSERT INTO athletes (name, gender, positions, flex, note, rank, school, rev, updated_at, updated_by, status, photo_at, crop, retired, id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...vals, next.id,
      );
    } else {
      this.ctx.storage.sql.exec(
        `UPDATE athletes SET name = ?, gender = ?, positions = ?, flex = ?, note = ?, rank = ?, school = ?, rev = ?, updated_at = ?, updated_by = ?,
         status = ?, photo_at = ?, crop = ?, retired = ? WHERE id = ? AND rev = ?`, ...vals, next.id, prevRev,
      );
    }
    const saved = this.athleteRow(next.id);
    if (!saved || saved.rev !== rev) throw new GlobalError("The player couldn't be saved. Try again.");
    const out = this.tagScoped([toMaster(saved)])[0] as MasterAthlete;
    this.mirrorAthletes([out]);
    this.fanOut([out]);
    return out;
  }

  /** Platform counts + every league's counts. "-before" tags also write (once) and verify a full backup of each league. */
  private async integritySweep(tag: string): Promise<IntegrityReport> {
    const backup = tag.endsWith("-before");
    const one = (q: string): number => Number(this.ctx.storage.sql.exec<{ n: number }>(q).toArray()[0]?.n ?? 0);
    const platform = {
      leagues: one("SELECT COUNT(*) AS n FROM leagues"), memberships: one("SELECT COUNT(*) AS n FROM memberships"),
      accounts: one("SELECT COUNT(*) AS n FROM accounts"), athletes: one("SELECT COUNT(*) AS n FROM athletes WHERE retired = 0"),
      retired: one("SELECT COUNT(*) AS n FROM athletes WHERE retired = 1"), sourceLinks: one("SELECT COUNT(*) AS n FROM source_links"),
      aliases: one("SELECT COUNT(*) AS n FROM aliases"), pushDevices: one("SELECT COUNT(*) AS n FROM push_devices"),
      schoolAthletes: one("SELECT COUNT(*) AS n FROM school_athletes"),
    };
    if (backup && !(await this.ctx.storage.get(`backup:stage:${tag}:platform`))) {
      await this.ctx.storage.put(`backup:stage:${tag}:platform`, {
        at: Date.now(), platform,
        leagues: this.ctx.storage.sql.exec("SELECT * FROM leagues").toArray(), memberships: this.ctx.storage.sql.exec("SELECT * FROM memberships").toArray(),
      });
      await this.ctx.storage.put(`backup:stage:${tag}:athletes`, this.ctx.storage.sql.exec("SELECT * FROM athletes").toArray());
    }
    const ids = this.ctx.storage.sql.exec<{ league_id: string }>("SELECT league_id FROM leagues ORDER BY created_at").toArray().map((r) => r.league_id);
    const leagues: IntegrityReport["leagues"] = [];
    for (const id of ids) {
      try {
        const r = await this.leagueFetch(id, "/integrity", { method: "POST", body: JSON.stringify({ tag, backup }) });
        const d = (await r.json().catch(() => ({}))) as { name?: string; counts?: Record<string, number | string>; backup?: { complete: boolean; counts: Record<string, number | string> | null; at: number; existed: boolean } };
        leagues.push({ id, ref: fnv(id).slice(0, 6), name: d.name ?? "", ok: r.ok, counts: d.counts ?? {}, backup: d.backup ?? null });
      } catch (e) {
        leagues.push({ id, ref: fnv(id).slice(0, 6), name: "", ok: false, counts: {}, backup: null, error: String(e).slice(0, 120) });
      }
    }
    const report: IntegrityReport = { tag, at: Date.now(), platform, leagues };
    // Compare with the matching "-before" run.
    if (tag.endsWith("-after")) {
      const before = await this.ctx.storage.get<IntegrityReport>(`integrity:${tag.replace(/-after$/, "-before")}`);
      if (before) report.diff = diffIntegrity(before, report);
    }
    await this.ctx.storage.put(`integrity:${tag}`, report);
    console.log("integrity", tag, JSON.stringify(this.publicIntegrity(report)).slice(0, 4000));
    return report;
  }

  /** The data check without league names, ids or commissioner ids (safe for any signed-in user). */
  private publicIntegrity(r: IntegrityReport): Record<string, unknown> {
    const strip = (c: Record<string, number | string> | null | undefined): Record<string, number | string> | null => {
      if (!c) return null;
      const { commissionerId: _c, school, ...rest } = c;
      return { ...rest, customSchool: school ? 1 : 0 };
    };
    const totals: Record<string, number> = {};
    for (const l of r.leagues) for (const [k, v] of Object.entries(l.counts)) if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
    return {
      tag: r.tag, at: r.at, platform: r.platform, totals,
      leagues: r.leagues.map((l) => ({ ref: l.ref, ok: l.ok, counts: strip(l.counts), backup: l.backup ? { complete: l.backup.complete, existed: l.backup.existed, at: l.backup.at, counts: strip(l.backup.counts) } : null, error: l.error })),
      diff: r.diff ? { ...r.diff, changes: r.diff.changes.map((c) => ({ ...c, before: c.field === "commissionerId" ? "(id)" : c.before, after: c.field === "commissionerId" ? (c.before === c.after ? "(same)" : "(changed)") : c.after })) } : undefined,
    };
  }

  /**
   * Shared identities for a school other than Cornwall Central. Any commissioner of a league at that school may add
   * players, edit them and set statuses (every change is logged). The league itself says who its commissioner is and
   * which school it plays for; nothing is taken from the client. A player's school can't be changed here.
   */
  private async schoolAction(user: GUser, action: Record<string, unknown>, via: string | null): Promise<Response> {
    if (!via) return this.gerr("Only a league commissioner can change player info.", 403);
    const w = await this.leagueFetch(via, "/school-whois");
    if (!w.ok) return this.gerr("That league wasn't found.", 403);
    const who = (await w.json()) as { commissionerId?: string; school?: string; cornwall?: boolean };
    if (who.cornwall || !who.school) return this.gerr("Cornwall Central players are managed by the Main League commissioner.", 403);
    if (!who.commissionerId || who.commissionerId !== user.id) return this.gerr("Only this league's commissioner can change player info.", 403);
    const school = who.school;
    await this.ensurePool();
    const str = (k: string): string => String(action[k] ?? "").trim();
    const type = str("type");
    const src = `${user.name} (${user.id}) via league ${via}`;
    try {
      if (type === "addAthlete") {
        const got = this.addSchoolAthlete({ name: action.name, gender: action.gender, position: action.position ?? action.pos ?? action.positions }, school, via, user, src);
        if (got.status === "existing") return Response.json({ error: `${got.athlete.name} (${got.athlete.school}) is already in the player database.`, athlete: got.athlete, existing: true }, { status: 409 });
        return Response.json({ athlete: got.athlete });
      }
      if (type === "importAthletes") return Response.json(await this.importAthletes(action, school, via, user, src));
      const row = this.athleteRow(str("athleteId") || str("id"));
      if (!row || row.retired === 1) throw new GlobalError("Player not found.");
      if (!row.school.trim() || !sameSchool(row.school, school)) return this.gerr(`${row.name} isn't a ${school} player, so this league can't change them.`, 403);
      const cur = toMaster(row);
      const next: MasterAthlete = { ...cur };
      const changes: [string, string, string][] = [];
      if (type === "editAthlete") {
        if (action.school !== undefined && !sameSchool(str("school") || school, school)) throw new GlobalError("A player's school can't be changed.");
        if (action.expectRev !== undefined && Number(action.expectRev) !== row.rev) {
          return Response.json({ error: `${cur.name} was just changed. Showing the latest.`, athlete: cur }, { status: 409 });
        }
        const posCode = (p: { positions: Pos[]; flex: boolean }): string => (p.flex ? "FLEX" : ALL_POS.filter((x) => p.positions.includes(x)).join("/"));
        if (str("name")) next.name = str("name").slice(0, 40);
        if (action.gender !== undefined) next.gender = str("gender") === "G" ? "G" : "B";
        if (action.note !== undefined) next.note = str("note").slice(0, 400);
        const pos = this.parsePositions(action.position ?? action.pos, action.positions);
        if (pos) { next.positions = pos.positions; next.flex = pos.flex; }
        if (next.name !== cur.name) changes.push(["name", cur.name, next.name]);
        if (next.gender !== cur.gender) changes.push(["gender", cur.gender, next.gender]);
        if (next.note !== cur.note) changes.push(["note", cur.note, next.note]);
        if (posCode(next) !== posCode(cur)) changes.push(["positions", posCode(cur), posCode(next)]);
      } else if (type === "setStatus") {
        next.status = cleanStatus(str("status"));
        if (next.status !== cur.status) changes.push(["status", cur.status, next.status]);
      } else if (type === "retireAthlete") {
        // Only for a mistake: the league that added the player can take them off the shared list (owned players stay where they are).
        const origin = this.ctx.storage.sql.exec<{ league_id: string }>("SELECT league_id FROM school_athletes WHERE id = ?", cur.id).toArray()[0];
        if (origin?.league_id !== via) return this.gerr(`${cur.name} was added by another league, so only that league can remove them from the shared list.`, 403);
        next.retired = true;
        changes.push(["retired", "no", "yes"]);
      } else {
        throw new GlobalError("Unknown player change.");
      }
      if (changes.length === 0) return Response.json({ athlete: this.tagScoped([cur])[0], changed: false });
      const out = this.saveMaster(next, row.rev, user);
      for (const [f, o, n] of changes) this.logChange(cur.id, f, o, n, src);
      return Response.json({ athlete: out, changed: true });
    } catch (e) {
      if (e instanceof GlobalError) return this.gerr(e.message);
      throw e;
    }
  }

  /** Same-school players with this exact identity (accents, case, punctuation, middle initials ignored). */
  private sameSchoolRows(name: string, school: string): AthleteRow[] {
    const key = identityKey(name);
    const base = normalizeName(name);
    const rows = this.ctx.storage.sql.exec<AthleteRow>("SELECT * FROM athletes WHERE retired = 0 AND school != ''").toArray();
    return rows.filter((r) => sameSchool(r.school, school) && (normalizeName(r.name) === base || (key.length >= 4 && identityKey(r.name) === key)));
  }

  /** Validates one roster row. Returns the problem, or the clean fields. */
  private checkImportRow(r: ImportRow): { error: string } | { name: string; gender: "B" | "G"; positions: Pos[]; flex: boolean; grade: string } {
    const name = String(r.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name || !normalizeName(name) || name.split(" ").length < 2) return { error: "Needs a first and last name." };
    const g = String(r.gender ?? "").trim().toUpperCase();
    const gender = g === "B" || g === "M" || g === "BOYS" || g === "BOY" ? "B" : g === "G" || g === "F" || g === "W" || g === "GIRLS" || g === "GIRL" ? "G" : null;
    if (!gender) return { error: "Gender must be B or G." };
    let pos: { positions: Pos[]; flex: boolean } | null = null;
    try { pos = this.parsePositions(String(r.position ?? ""), null); } catch { pos = null; }
    if (!pos) return { error: "Position must be SPR, DIS, FLD or FLEX (or a combo like SPR/DIS)." };
    const grade = String(r.grade ?? "").trim().slice(0, 4);
    return { name, gender, ...pos, grade };
  }

  private addSchoolAthlete(r: ImportRow, school: string, leagueId: string, user: GUser, src: string): { status: "new" | "existing"; athlete: MasterAthlete } {
    const c = this.checkImportRow(r);
    if ("error" in c) throw new GlobalError(c.error);
    const dupe = this.sameSchoolRows(c.name, school).find((x) => x.gender === c.gender) ?? this.sameSchoolRows(c.name, school)[0];
    if (dupe) return { status: "existing", athlete: this.tagScoped([toMaster(dupe)])[0] as MasterAthlete };
    const base = normalizeName(c.name);
    const key = canonSchool(school);
    let id = this.athleteRow(base) ? `${base}-${key}` : base;
    for (let i = 2; this.athleteRow(id); i++) id = `${base}-${key}-${i}`;
    const rank = (this.ctx.storage.sql.exec<{ m: number | null }>("SELECT MAX(rank) AS m FROM athletes").toArray()[0]?.m ?? -1) + 1;
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO school_athletes (id, school_key, league_id, at) VALUES (?, ?, ?, ?)", id, key, leagueId, Date.now());
    const out = this.saveMaster({
      id, name: c.name, gender: c.gender, positions: c.positions, flex: c.flex, note: "", rank, school, rev: 0, status: "active", photoAt: null, crop: null, retired: false,
    }, null, user);
    this.logChange(id, "added", "", c.name, src);
    return { status: "new", athlete: out };
  }

  /**
   * Roster import (pasted list or spreadsheet). "preview" sorts every row into new / existing / possible duplicate /
   * invalid and changes nothing. "commit" adds only new rows (and possible duplicates the commissioner confirmed as
   * different people). Existing players are never overwritten. A repeated requestId returns the first result.
   */
  private async importAthletes(action: Record<string, unknown>, school: string, leagueId: string, user: GUser, src: string): Promise<Record<string, unknown>> {
    const rows = (Array.isArray(action.rows) ? action.rows : []).slice(0, 400) as ImportRow[];
    if (rows.length === 0) throw new GlobalError("Paste at least one player.");
    const commit = action.mode === "commit";
    const requestId = String(action.requestId ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
    if (commit && !requestId) throw new GlobalError("Missing request id.");
    if (commit) {
      const prior = await this.ctx.storage.get<Record<string, unknown>>(`import:${leagueId}:${requestId}`);
      if (prior) return { ...prior, repeated: true };
    }
    const all = this.ctx.storage.sql.exec<AthleteRow>("SELECT * FROM athletes WHERE retired = 0 AND school != ''").toArray().filter((r) => sameSchool(r.school, school));
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];
    const added: MasterAthlete[] = [];
    for (const [i, r] of rows.entries()) {
      const c = this.checkImportRow(r);
      const raw = { name: String(r.name ?? ""), gender: String(r.gender ?? ""), position: String(r.position ?? ""), grade: String(r.grade ?? "") };
      if ("error" in c) { out.push({ row: i + 1, ...raw, status: "invalid", reason: c.error }); continue; }
      const fileKey = `${identityKey(c.name)}|${c.gender}`;
      if (seen.has(fileKey)) { out.push({ row: i + 1, ...raw, status: "invalid", reason: "Listed twice in this import." }); continue; }
      seen.add(fileKey);
      const exact = this.sameSchoolRows(c.name, school);
      if (exact.length > 0) {
        const m = exact[0] as AthleteRow;
        out.push({ row: i + 1, ...raw, status: "existing", athleteId: m.id, match: m.name, reason: `Already on file as ${m.name}. Nothing changes.` });
        continue;
      }
      const loose = all.filter((x) => x.gender === c.gender && looseNameMatch(x.name, c.name));
      if (loose.length > 0 && r.confirmNew !== true) {
        out.push({ row: i + 1, ...raw, status: "possible", candidates: loose.slice(0, 3).map((x) => ({ id: x.id, name: x.name })), reason: `Looks like ${loose.slice(0, 3).map((x) => x.name).join(", ")}. Confirm it's a different person to add.` });
        continue;
      }
      if (!commit) { out.push({ row: i + 1, ...raw, status: "new", reason: loose.length ? "Confirmed as a different person." : "New player." }); continue; }
      const got = this.addSchoolAthlete(r, school, leagueId, user, `${src} (roster import)`);
      if (got.status === "existing") { out.push({ row: i + 1, ...raw, status: "existing", athleteId: got.athlete.id, match: got.athlete.name, reason: "Already on file. Nothing changes." }); continue; }
      added.push(got.athlete);
      all.push(this.athleteRow(got.athlete.id) as AthleteRow);
      out.push({ row: i + 1, ...raw, status: "added", athleteId: got.athlete.id, reason: "Added." });
    }
    const count = (st: string): number => out.filter((x) => x.status === st).length;
    const result = {
      school, mode: commit ? "commit" : "preview", rows: out,
      summary: { total: rows.length, new: count("new"), added: count("added"), existing: count("existing"), possible: count("possible"), invalid: count("invalid") },
      athletes: added,
    };
    if (commit) await this.ctx.storage.put(`import:${leagueId}:${requestId}`, { ...result, athletes: [] });
    return result;
  }

  /** Every master-player change: Main League commissioner only (asked of the Main League itself), validated, logged, pushed. */
  private async masterAction(user: GUser, action: Record<string, unknown>, via: string | null): Promise<Response> {
    const c = await this.config();
    if (!c.mainLeagueId) return this.gerr(`The Main League (${MAIN_LEAGUE_CODE}) wasn't found.`, 403);
    if (via !== c.mainLeagueId) return this.gerr("Player info is set by the Main League. Only the Main League commissioner can change it.", 403);
    const commish = await this.mainCommissioner(c);
    if (!commish || commish !== user.id) return this.gerr("Only the Main League commissioner can change player info.", 403);
    await this.ensurePool();
    const str = (k: string): string => String(action[k] ?? "").trim();
    const type = str("type");
    const src = `${user.name} (${user.id})`;
    try {
      if (type === "addAthlete") {
        const name = str("name").slice(0, 40);
        const base = normalizeName(name);
        if (!name || !base) throw new GlobalError("Enter a valid name.");
        const school = str("school").slice(0, 60);
        const same = this.ctx.storage.sql.exec<AthleteRow>("SELECT * FROM athletes WHERE id = ? OR id LIKE ?", base, `${base}-%`).toArray();
        const sch = (x: string): string => normalizeName(x).replace(/(highschool|seniorhigh|hs|school|academy)$/g, "");
        const dupe = same.find((r) => r.retired !== 1 && (sch(r.school) === sch(school) || !r.school || !school));
        if (dupe) return Response.json({ error: `${dupe.name}${dupe.school ? ` (${dupe.school})` : ""} is already in the player database.`, athlete: toMaster(dupe), existing: true }, { status: 409 });
        const id = same.length === 0 ? base : `${base}-${sch(school) || same.length + 1}`;
        if (this.athleteRow(id)) throw new GlobalError("That player already exists.");
        const pos = this.parsePositions(action.position ?? action.pos, action.positions);
        if (!pos) throw new GlobalError("Pick a position.");
        const rank = (this.ctx.storage.sql.exec<{ m: number | null }>("SELECT MAX(rank) AS m FROM athletes").toArray()[0]?.m ?? -1) + 1;
        const out = this.saveMaster({
          id, name, gender: str("gender") === "G" ? "G" : "B", ...pos, note: "", rank, school, rev: 0, status: "active", photoAt: null, crop: null, retired: false,
        }, null, user);
        this.logChange(id, "added", "", name, src);
        return Response.json({ athlete: out });
      }
      const row = this.athleteRow(str("athleteId") || str("id"));
      if (!row) throw new GlobalError("Player not found.");
      const cur = toMaster(row);
      const next: MasterAthlete = { ...cur };
      const changes: [string, string, string][] = [];
      if (type === "editAthlete") {
        const posCode = (p: { positions: Pos[]; flex: boolean }): string => (p.flex ? "FLEX" : ALL_POS.filter((x) => p.positions.includes(x)).join("/"));
        if (action.expectRev !== undefined && Number(action.expectRev) !== row.rev) {
          return Response.json({ error: `${cur.name} was just changed. Showing the latest.`, athlete: cur }, { status: 409 });
        }
        if (action.expectPosition !== undefined && (action.position !== undefined || action.positions !== undefined) && str("expectPosition") !== posCode(cur)) {
          return Response.json({ error: `${cur.name}'s position was just changed to ${posCode(cur)}. Showing the latest.`, athlete: cur }, { status: 409 });
        }
        if (str("name")) next.name = str("name").slice(0, 40);
        if (action.school !== undefined) next.school = str("school").slice(0, 60);
        if (action.gender !== undefined) next.gender = str("gender") === "G" ? "G" : "B";
        if (action.note !== undefined) next.note = str("note").slice(0, 400);
        const pos = this.parsePositions(action.position ?? action.pos, action.positions);
        if (pos) { next.positions = pos.positions; next.flex = pos.flex; }
        if (next.name !== cur.name) changes.push(["name", cur.name, next.name]);
        if (next.school !== cur.school) changes.push(["school", cur.school, next.school]);
        if (next.gender !== cur.gender) changes.push(["gender", cur.gender, next.gender]);
        if (next.note !== cur.note) changes.push(["note", cur.note, next.note]);
        if (posCode(next) !== posCode(cur)) changes.push(["positions", posCode(cur), posCode(next)]);
      } else if (type === "setStatus") {
        next.status = cleanStatus(str("status"));
        if (next.status !== cur.status) changes.push(["status", cur.status, next.status]);
      } else if (type === "setPhoto" || type === "removePhoto") {
        if (action.expectAt !== undefined && (action.expectAt ?? null) !== (cur.photoAt ?? null)) {
          return Response.json({ error: `${cur.name}'s photo was just changed. Showing the latest.`, athlete: cur }, { status: 409 });
        }
        if (type === "removePhoto") {
          if (!cur.photoAt) return Response.json({ athlete: cur, changed: false });
          next.photoAt = null;
          next.crop = null;
          changes.push(["photo", "photo", "removed"]);
        } else {
          const b64 = str("image").replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
          if (b64.length < 200 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new GlobalError("That photo couldn't be used. Try another image.");
          if (b64.length > MAX_PHOTO_B64) throw new GlobalError("That photo is too large. Try again.");
          if (!b64.startsWith("/9j/")) throw new GlobalError("Photos must be saved as JPEG.");
          const at = Math.max(Date.now(), (cur.photoAt ?? 0) + 1);
          await this.ctx.storage.put(`mphoto:${cur.id}:${at}`, b64);
          next.photoAt = at;
          next.crop = cleanCrop(action.crop) ?? cur.crop;
          changes.push(["photo", cur.photoAt ? "photo" : "none", `new headshot (${Math.round((b64.length * 3) / 4 / 1024)} KB)`]);
        }
      } else if (type === "removeAthlete" || type === "retireAthlete") {
        next.retired = true;
        changes.push(["retired", "no", "yes"]);
      } else {
        throw new GlobalError("Unknown player change.");
      }
      if (changes.length === 0) return Response.json({ athlete: cur, changed: false });
      const out = this.saveMaster(next, row.rev, user);
      for (const [f, o, n] of changes) this.logChange(cur.id, f, o, n, src);
      return Response.json({ athlete: out, changed: true });
    } catch (e) {
      if (e instanceof GlobalError) return this.gerr(e.message);
      throw e;
    }
  }

  private async poolRoutes(request: Request, url: URL): Promise<Response | null> {
    if (request.method === "GET" && url.pathname === "/athletes") {
      try {
        await this.ensurePool();
      } catch (e) {
        return err(`Player database isn't ready yet: ${String(e).slice(0, 120)}`, 503);
      }
      const since = Number(url.searchParams.get("since") ?? "0") || 0;
      const rows = this.ctx.storage.sql.exec<AthleteRow>("SELECT * FROM athletes WHERE rev > ? ORDER BY rank", since).toArray();
      return Response.json({ migrated: true, rev: Number(this.meta("pool_rev") ?? "0"), athletes: this.tagScoped(rows.map(toMaster)) });
    }

    if (request.method === "GET" && url.pathname === "/master-photo") {
      const id = url.searchParams.get("id") ?? "";
      const r = this.athleteRow(id);
      if (!r?.photo_at) return new Response("not found", { status: 404 });
      const b64 = await this.ctx.storage.get<string>(`mphoto:${id}:${r.photo_at}`);
      if (!b64) return new Response("not found", { status: 404 });
      const current = url.searchParams.get("v") === String(r.photo_at);
      return new Response(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": current ? "public, max-age=31536000, immutable" : "no-store", ETag: `"${id}-${r.photo_at}"` },
      });
    }

    if (request.method === "POST" && url.pathname === "/integrity-sweep") {
      const b = (await request.json()) as { tag?: string };
      const tag = String(b.tag ?? "");
      if (!INTEGRITY_TAGS.has(tag)) return this.gerr("Unknown check.");
      const last = Number(this.meta("integrity_last_run") ?? "0");
      if (Date.now() - last < 2 * 60_000) return this.gerr("A data check just ran. Try again in a couple of minutes.", 429);
      this.setMeta("integrity_last_run", String(Date.now()));
      return Response.json(this.publicIntegrity(await this.integritySweep(tag)));
    }

    if (request.method === "GET" && url.pathname === "/integrity-report") {
      const tag = url.searchParams.get("tag") ?? "";
      const rep = await this.ctx.storage.get<IntegrityReport>(`integrity:${tag}`);
      if (!rep) return this.gerr("No data check has run for that tag yet.", 404);
      const c = await this.config();
      const detail = url.searchParams.get("detail") === "1" && !!c.mainLeagueId && (await this.mainCommissioner(c)) === (url.searchParams.get("userId") ?? "-");
      return Response.json(detail ? rep : this.publicIntegrity(rep));
    }

    if (request.method === "POST" && url.pathname === "/school-action") {
      const b = (await request.json()) as { user?: GUser; action?: Record<string, unknown>; via?: string | null };
      if (!b.user?.id) return this.gerr("Sign in again.", 401);
      return this.schoolAction(b.user, b.action ?? {}, b.via ?? null);
    }

    if (request.method === "GET" && url.pathname === "/schools") {
      // School names for the create-league picker: every school with players on file, plus Cornwall Central.
      const rows = this.ctx.storage.sql.exec<{ school: string; n: number }>("SELECT school, COUNT(*) AS n FROM athletes WHERE retired = 0 GROUP BY school").toArray();
      const by = new Map<string, { name: string; athletes: number }>();
      for (const r of rows) {
        const name = r.school.trim() || POOL_SCHOOL;
        const k = canonSchool(name);
        if (!k) continue;
        const cur = by.get(k) ?? { name: isCornwallName(name) ? POOL_SCHOOL : name, athletes: 0 };
        cur.athletes += r.n;
        by.set(k, cur);
      }
      return Response.json({ schools: [...by.values()].sort((a, b) => b.athletes - a.athletes || a.name.localeCompare(b.name)).slice(0, 200) });
    }

    if (request.method === "POST" && url.pathname === "/master-action") {
      const b = (await request.json()) as { user?: GUser; action?: Record<string, unknown>; via?: string | null };
      if (!b.user?.id) return this.gerr("Sign in again.", 401);
      return this.masterAction(b.user, b.action ?? {}, b.via ?? null);
    }

    if (request.method === "GET" && url.pathname === "/source-links") {
      const rows = this.ctx.storage.sql.exec<LinkRow>("SELECT * FROM source_links").toArray();
      const aliases = this.ctx.storage.sql.exec<{ alias: string; athlete_id: string; name: string; gender: string; source: string; at: number }>("SELECT * FROM aliases").toArray();
      return Response.json({ links: rows.map(toLink), aliases: aliases.map((a) => ({ alias: a.alias, athleteId: a.athlete_id, name: a.name, gender: a.gender, source: a.source, at: a.at })) });
    }

    // Commissioner-confirmed name aliases ("Ben Huang" = Benjamin Huang). Permanent; never creates a second player.
    if (request.method === "POST" && url.pathname === "/aliases") {
      const b = (await request.json()) as { alias?: string; name?: string; athleteId?: string; gender?: string; by?: string; remove?: boolean };
      const alias = String(b.alias ?? "").slice(0, 80);
      const aid = String(b.athleteId ?? "").slice(0, 80);
      if (!alias || !aid) return this.gerr("Alias and player are required.");
      if (b.remove === true) {
        this.ctx.storage.sql.exec("DELETE FROM aliases WHERE alias = ? AND athlete_id = ?", alias, aid);
        this.logChange(aid, "alias", alias, "removed", String(b.by ?? ""));
        return Response.json({ ok: true });
      }
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO aliases (alias, athlete_id, name, gender, source, at) VALUES (?, ?, ?, ?, ?, ?)", alias, aid, String(b.name ?? "").slice(0, 80), String(b.gender ?? ""), String(b.by ?? "").slice(0, 80), Date.now());
      this.logChange(aid, "alias", "", String(b.name ?? alias), `confirmed by ${String(b.by ?? "")}`);
      return Response.json({ ok: true });
    }

    // Main League scoring only: confident source-id → master player links. A source id that later shows up with a
    // materially different athlete is flagged SOURCE ID CONFLICT, never re-pointed.
    if (request.method === "POST" && url.pathname === "/source-links") {
      const b = (await request.json()) as { observations?: Record<string, unknown>[]; resolve?: { sourceId: string; athleteId: string | null; by: string } };
      const now = Date.now();
      if (b.resolve?.sourceId) {
        const r = b.resolve;
        if (r.athleteId) {
          const ex = this.ctx.storage.sql.exec<LinkRow>("SELECT * FROM source_links WHERE source_id = ?", r.sourceId).toArray()[0];
          if (ex) this.ctx.storage.sql.exec("UPDATE source_links SET athlete_id = ?, conflict = '', last_seen = ? WHERE source_id = ?", r.athleteId, now, r.sourceId);
          this.logChange(r.athleteId, "source-link", ex?.athlete_id ?? "", r.sourceId, `conflict resolved by ${r.by}`);
        } else {
          this.ctx.storage.sql.exec("DELETE FROM source_links WHERE source_id = ?", r.sourceId);
          this.logChange("*", "source-link", r.sourceId, "removed", `conflict resolved by ${r.by}`);
        }
        return Response.json({ ok: true });
      }
      let added = 0;
      let conflicts = 0;
      for (const o of (b.observations ?? []).slice(0, 500)) {
        const sid = String(o.sourceId ?? "").slice(0, 80);
        const aid = String(o.athleteId ?? "").slice(0, 80);
        const name = String(o.name ?? "").slice(0, 80);
        if (!sid || !aid || !name) continue;
        const meetId = String(o.meetId ?? "").slice(0, 40);
        const ex = this.ctx.storage.sql.exec<LinkRow>("SELECT * FROM source_links WHERE source_id = ?", sid).toArray()[0];
        if (!ex) {
          if (o.seen === true) continue;
          this.ctx.storage.sql.exec(
            "INSERT INTO source_links (source_id, athlete_id, name, school, gender, grade, provider, first_seen, last_seen, meets, conflict) VALUES (?, ?, ?, ?, ?, ?, 'athleticlive', ?, ?, ?, '')",
            sid, aid, name, String(o.school ?? "").slice(0, 80), String(o.gender ?? ""), String(o.grade ?? ""), now, now, JSON.stringify(meetId ? [meetId] : []),
          );
          this.logChange(aid, "source-link", "", sid, `linked from meet ${meetId}`);
          added++;
          continue;
        }
        const meets = new Set<string>(JSON.parse(ex.meets || "[]") as string[]);
        if (meetId) meets.add(meetId);
        const different = ex.athlete_id !== aid || (String(o.gender ?? "") && ex.gender && String(o.gender) !== ex.gender) || !(norm(ex.name) === norm(name) || looseNameMatch(ex.name, name));
        if (different && !ex.conflict) {
          const why = `${sid} was ${ex.name} (${ex.school || "no school"}) but meet ${meetId} shows ${name} (${String(o.school ?? "") || "no school"}).`;
          this.ctx.storage.sql.exec("UPDATE source_links SET conflict = ?, last_seen = ? WHERE source_id = ?", why, now, sid);
          this.logChange(ex.athlete_id, "source-conflict", ex.name, name, why);
          conflicts++;
          continue;
        }
        this.ctx.storage.sql.exec("UPDATE source_links SET last_seen = ?, meets = ?, grade = CASE WHEN ? != '' THEN ? ELSE grade END WHERE source_id = ?",
          now, JSON.stringify([...meets].slice(-60)), String(o.grade ?? ""), String(o.grade ?? ""), sid);
      }
      return Response.json({ ok: true, added, conflicts });
    }

    if (request.method === "GET" && url.pathname === "/pool-status") {
      const c = await this.config();
      const commish = await this.mainCommissioner(c);
      if (!commish || commish !== (url.searchParams.get("userId") ?? "")) return this.gerr("Only the Main League commissioner can see this.", 403);
      await this.ensurePool();
      const log = this.ctx.storage.sql.exec<{ athlete_id: string; field: string; old: string; new: string; source: string; at: number }>(
        "SELECT athlete_id, field, old, new, source, at FROM pool_log ORDER BY id DESC LIMIT 500",
      ).toArray();
      const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM athletes WHERE retired = 0").toArray()[0]?.n ?? 0;
      const backups = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pool_backup").toArray()[0]?.n ?? 0;
      return Response.json({
        migratedAt: Number(this.meta("pool_v2") ?? "0"), leaguesScanned: Number(this.meta("pool_migrated_leagues") ?? "0"),
        count, rev: Number(this.meta("pool_rev") ?? "0"), backups, log,
      });
    }
    return null;
  }

  private account(email: string): AccountRow | undefined {
    return this.ctx.storage.sql.exec<AccountRow>("SELECT * FROM accounts WHERE email = ?", email).toArray()[0];
  }

  private accountById(id: string): AccountRow | undefined {
    return this.ctx.storage.sql.exec<AccountRow>("SELECT * FROM accounts WHERE id = ?", id).toArray()[0];
  }

  private publicUser(a: AccountRow): { id: string; name: string; email: string } {
    return { id: a.id, name: a.name, email: a.email };
  }

  // MARK: - Global Fantasy T&F configuration (anchored to the Main League, code T7RAN2)

  private cfg: GlobalConfig | null = null;
  private seeding: Promise<GlobalConfig> | null = null;
  private lastPushAt = 0;

  /** The Main League id: resolved once from its invite code, then stored permanently. Nothing can change it. */
  private mainLeagueId(): string | null {
    const stored = this.meta("main_league_id");
    if (stored) return stored;
    const row = this.ctx.storage.sql.exec<{ league_id: string }>("SELECT league_id FROM leagues WHERE code = ?", MAIN_LEAGUE_CODE).toArray()[0];
    if (!row) return null;
    this.setMeta("main_league_id", row.league_id);
    return row.league_id;
  }

  /** Loads the global config, seeding it once from the Main League's current setup (nothing in that league changes). */
  private async config(): Promise<GlobalConfig> {
    if (this.cfg) return this.cfg;
    const saved = await this.ctx.storage.get<GlobalConfig>("globalConfig");
    if (saved) {
      this.cfg = normalizeConfig(saved);
      await this.ensureOfficialTables(this.cfg);
      await this.ensureTablesV2(this.cfg);
      return this.cfg;
    }
    this.seeding ??= this.seed().finally(() => { this.seeding = null; });
    return this.seeding;
  }

  /**
   * One-time load of the commissioner's official time/mark tables (Oct 2026) into every season 2026–2032. Exact values,
   * as sent. Only the 22 listed event tables are replaced (the old rows are retired, never deleted); every other event
   * keeps its existing rows. A snapshot of the previous config is stored first.
   */
  private async ensureOfficialTables(c: GlobalConfig): Promise<void> {
    if (!c.mainLeagueId || this.meta("official_tables_v1")) return;
    const now = Date.now();
    await this.ctx.storage.put(`snapshot:config:${now}`, c);
    c.tableVersion = (c.tableVersion ?? 1) + 1;
    let rows = c.performance;
    let n = 0;
    for (const season of OFFICIAL_SEASONS) {
      for (const t of OFFICIAL_TABLES) {
        const r = setPerformanceRows(rows, { event: t.event, gender: t.gender, season, tiers: t.tiers.map(([mark, points]) => ({ mark, points })) }, season, now, c.tableVersion);
        rows = r.rows;
        n += t.tiers.length;
      }
    }
    c.performance = rows;
    c.audit.push({ at: now, actorId: "system", actorName: "Main League tables", action: "performance.official", detail: `Loaded the official tables exactly as supplied: ${OFFICIAL_TABLES.length} event tables × ${OFFICIAL_SEASONS.length} seasons (${n} tiers), table v${c.tableVersion}. Other events unchanged.` });
    c.tableLog = [...(c.tableLog ?? []), { at: now, version: c.tableVersion, by: "Main League (official tables)", detail: `Official tables 2026–2032 (${n} tiers)` }].slice(-200);
    this.setMeta("official_tables_v1", String(now));
    await this.saveConfig(c, null, true);
    this.pushConfig(c, []);
  }

  /**
   * One-time merge of the commissioner's 5-tier tables (Oct 29 2026) into every season 2026–2032 and the new
   * unseeded percentile brackets (all 0). Approved to apply to ALL 2026 results: the merged rows are active for every
   * week (since -1) and the rows they supersede for those events never apply again (until 0). A full snapshot of the
   * previous config is stored first and listed as a restore point. Every merge decision is saved in a report.
   */
  private async ensureTablesV2(c: GlobalConfig): Promise<void> {
    if (!TABLES_V2_ENABLED || !c.mainLeagueId || this.meta("official_tables_v2")) return;
    const now = Date.now();
    const notes: MergeNote[] = [];
    let rows = c.performance;
    const ver = (c.tableVersion ?? 1) + 1;
    try {
      for (const season of OFFICIAL_SEASONS) {
        for (const t of OFFICIAL_TABLES_V2) {
          const k = keyOf(t.event);
          const live = liveRows(rows).filter((p) => p.season === season && p.gender === t.gender && keyOf(p.event) === k);
          const m = mergeTiers(t.event, t.gender, season, live.map((p) => ({ mark: p.mark, points: p.points })), t.tiers);
          const problems = validateTable(t.event, m.tiers);
          if (problems.length > 0) throw new GlobalError(`${season} ${t.gender} ${t.event}: ${problems.join(" ")}`);
          notes.push(...m.notes);
          const r = setPerformanceRows(rows, { event: t.event, gender: t.gender, season, tiers: m.tiers }, season, now, ver);
          const fresh = new Set(r.rows.filter((p) => p.since === now && p.season === season && p.gender === t.gender && keyOf(p.event) === k).map((p) => p.id));
          rows = r.rows.map((p) => (p.season === season && p.gender === t.gender && keyOf(p.event) === k
            ? (fresh.has(p.id) ? { ...p, since: -1 } : { ...p, until: 0 })
            : p));
        }
      }
    } catch (e) {
      console.error("tables v2 merge aborted", String(e));
      this.setMeta("official_tables_v2_error", String(e).slice(0, 500));
      return;
    }
    await this.ctx.storage.put(`snapshot:config:${now}`, c);
    await this.ctx.storage.put("restorepoint:tablesV2", { at: now, label: "Before the 5-tier tables + unseeded brackets (Oct 29 2026)", config: c });
    c.performance = rows;
    c.tableVersion = ver;
    const cur = currentRules(c);
    const version = c.scoringVersion + 1;
    c.rules.push({ since: now, rules: cleanScoring({ ...cur, percentileUnseeded: cur.percentileUnseeded ?? UNSEEDED_DEFAULT }, cur), version, by: "Main League (5-tier tables + unseeded brackets)" });
    const count = (o: MergeNote["outcome"]): number => notes.filter((n) => n.outcome === o).length;
    const summary = `5-tier tables merged into ${OFFICIAL_TABLES_V2.length} event tables × ${OFFICIAL_SEASONS.length} seasons: ${count("added")} tiers added, ${count("kept")} kept, ${count("replaced")} replaced (same points), ${count("dropped")} dropped (out of order). Applies to every 2026 result. Unseeded brackets added at 0 points (scoring v${version}).`;
    c.audit.push({ at: now, actorId: "system", actorName: "Main League tables", action: "performance.official", detail: summary.slice(0, 600) });
    c.tableLog = [...(c.tableLog ?? []), { at: now, version: ver, by: "Main League (5-tier tables)", detail: summary.slice(0, 300) }].slice(-200);
    await this.ctx.storage.put("report:tablesV2", { at: now, tableVersion: ver, scoringVersion: version, summary, notes });
    this.setMeta("official_tables_v2", String(now));
    await this.saveConfig(c, null, true);
    this.pushConfig(c, []);
  }

  private async seed(): Promise<GlobalConfig> {
    const now = Date.now();
    const mainId = this.mainLeagueId();
    if (!mainId) {
      // No league with the Main League code exists: defaults apply and nobody can edit. Not saved, so it retries.
      return defaultConfig("", now);
    }
    const c = defaultConfig(mainId, now);
    const r = await this.leagueFetch(mainId, "/global-seed");
    if (!r.ok) throw new Error(`main league seed failed: ${r.status}`);
    const seed = (await r.json()) as {
      commissionerId: string; settings: Record<string, unknown>; standards: Standard[]; performance: PerformanceRule[];
      meets: Meet[]; feeds: Record<string, RawFeed>;
    };
    c.mainCommissionerId = seed.commissionerId;
    c.settings = cleanSettings(seed.settings ?? {}, c.settings);
    c.standards = (seed.standards ?? []).map((x) => ({ ...x, id: `${x.id}-g`, since: 0, until: null, scope: "global" as const, fromWeek: undefined, toWeek: undefined }));
    c.performance = (seed.performance ?? []).map((x) => ({ ...x, id: `${x.id}-g`, since: 0, until: null, scope: "global" as const, fromWeek: undefined, toWeek: undefined }));
    c.meets = (seed.meets ?? []).map((m) => ({ ...m, scope: "global" as const, feedChangedAt: m.stats?.lastChangeAt ?? null }));
    for (const [id, f] of Object.entries(seed.feeds ?? {})) await this.putFeed(id, f);
    c.audit.push({ at: now, actorId: "system", actorName: "System", action: "global.init", detail: `Global setup created from the Main League (${MAIN_LEAGUE_CODE}): ${c.standards.length} standards, ${c.performance.length} table rows, ${c.meets.length} meets.` });
    await this.ctx.storage.put("globalConfig", c);
    this.cfg = c;
    await this.scheduleGlobalAlarm();
    this.pushConfig(c, []);
    await this.ensureOfficialTables(c);
    return c;
  }

  private async saveConfig(c: GlobalConfig, user: GUser | null, bumpScoring = false): Promise<void> {
    c.version += 1;
    if (bumpScoring) c.scoringVersion += 1;
    c.updatedAt = Date.now();
    if (user) c.updatedBy = user.name;
    if (c.audit.length > 300) c.audit = c.audit.slice(-300);
    await this.ctx.storage.put("globalConfig", c);
    this.cfg = c;
    await this.scheduleGlobalAlarm();
  }

  private publicConfig(c: GlobalConfig): Record<string, unknown> {
    return { ...c, audit: c.audit.slice(-60) };
  }

  private async putFeed(meetId: string, f: RawFeed): Promise<void> {
    await this.ctx.storage.put({ [`gfeed:${meetId}:events`]: f.events.slice(0, 900_000), [`gfeed:${meetId}:roster`]: f.roster.slice(0, 900_000), [`gfeed:${meetId}:results`]: f.results.slice(0, 1_500_000) });
  }

  private async getFeed(meetId: string): Promise<RawFeed> {
    const m = await this.ctx.storage.get<string>([`gfeed:${meetId}:events`, `gfeed:${meetId}:roster`, `gfeed:${meetId}:results`]);
    return { events: m.get(`gfeed:${meetId}:events`) ?? "", roster: m.get(`gfeed:${meetId}:roster`) ?? "", results: m.get(`gfeed:${meetId}:results`) ?? "" };
  }

  /** Sends the current config to every league (they apply it only if newer). `sync` = meets whose results changed. */
  private pushConfig(c: GlobalConfig, sync: string[]): void {
    this.lastPushAt = Date.now();
    const leagues = this.ctx.storage.sql.exec<{ league_id: string }>("SELECT league_id FROM leagues").toArray().map((r) => r.league_id);
    const body = JSON.stringify({ config: this.publicConfig(c), sync });
    this.ctx.waitUntil((async () => {
      const queue = [...leagues];
      const worker = async (): Promise<void> => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const r = await this.leagueFetch(id, "/global-apply", { method: "POST", body });
              if (r.ok) {
                const s = (await r.json()) as { version?: number; phase?: string; shapePending?: boolean };
                this.ctx.storage.sql.exec("INSERT OR REPLACE INTO league_sync (league_id, version, phase, shape_pending, at) VALUES (?, ?, ?, ?, ?)", id, s.version ?? 0, s.phase ?? "", s.shapePending ? 1 : 0, Date.now());
                break;
              }
              if (r.status === 404) break;
            } catch (e) {
              console.warn("global push failed", id, String(e));
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker()));
    })());
  }

  private async scheduleGlobalAlarm(): Promise<void> {
    const c = this.cfg;
    const times = (c?.meets ?? []).filter((m) => m.polling && m.nextSyncAt !== null).map((m) => m.nextSyncAt as number);
    const now = Date.now();
    for (const m of c?.meets ?? []) { const at = nextScheduleAt(m, now); if (at !== null) times.push(at); }
    if (times.length === 0) {
      await this.env.DO.deleteAlarm("Directory", "global").catch(() => undefined);
      return;
    }
    await this.env.DO.setAlarm("Directory", "global", Math.max(Date.now() + 500, Math.min(...times)));
  }

  /** Reads one global meet's source once. Leagues score the stored copy independently. */
  private async pollMeet(c: GlobalConfig, m: Meet, final = false): Promise<{ changed: boolean; error: string | null; state: boolean }> {
    const now = Date.now();
    m.lastAttemptAt = now;
    const before = `${m.status}|${m.polling}|${m.sourceError ?? ""}`;
    let feed: RawFeed;
    let listed: string[] = [];
    let done = false;
    try {
      if (m.provider === "MANUAL") {
        feed = await this.getFeed(m.id);
        if (!feed.results.trim()) throw new SourceError("Paste the results data for this meet first.", "config");
      } else {
        const got = await fetchMeetFeed(m);
        feed = got.feed;
        // A partial re-read (events with results suddenly unreadable) is an outage, not a correction: keep the last copy.
        if (got.imp) {
          const prev = await this.getFeed(m.id);
          const prevRows = prev.results.trim() ? Math.max(0, parseCsv(prev.results).length - 1) : 0;
          const why = incompleteImport(got.imp, prevRows);
          if (why) throw new SourceError(why, "unreachable");
        }
      }
      const out = normalizeFeed(m.id, feed, final || m.status === "FINAL", now, {});
      if (out.format !== "empty" && out.rows.length === 0) throw new SourceError("The results feed was readable but contained no results rows.", "format");
      listed = out.listedEvents;
      done = listed.length > 0 && listed.every((id) => {
        const rows = out.rows.filter((r) => r.sourceEventId === id);
        return rows.length > 0 && rows.every((r) => r.completeness !== "LIVE");
      });
    } catch (e) {
      m.sourceError = e instanceof SourceError ? e.message : "Live source unavailable.";
      m.sourceErrorKind = e instanceof SourceError ? e.kind : "unreachable";
      m.sourceErrorAt = now;
      m.failures += 1;
      if (m.polling) m.nextSyncAt = now + Math.min(120_000, c.live.pollSeconds * 1000 * 2 ** Math.min(3, m.failures));
      return { changed: false, error: m.sourceError, state: before !== `${m.status}|${m.polling}|${m.sourceError ?? ""}` };
    }
    m.sourceError = null;
    m.sourceErrorKind = null;
    m.failures = 0;
    m.syncCount += 1;
    m.lastSyncedAt = now;
    const h = fnv(`${feed.events}\u0001${feed.roster}\u0001${feed.results}`);
    const changed = h !== m.feedHash;
    if (changed) {
      await this.putFeed(m.id, feed);
      m.feedHash = h;
      m.feedChangedAt = now;
    }
    m.complete = listed.length > 0 ? done : feed.results.trim().length > 0;
    if (m.status === "LIVE" && m.polling && done && m.feedChangedAt && now - m.feedChangedAt > c.live.autoFinalMinutes * 60_000) {
      if (!isScheduled(m)) {
        m.status = "FINAL"; m.polling = false; m.nextSyncAt = null; m.finalAt = now;
        c.audit.push({ at: now, actorId: "source", actorName: "Live source", action: "meet.final", detail: `${m.name}: every event complete, marked final automatically` });
      } else if (m.pendingSince == null && !m.lifecycle && !m.correcting) {
        // Scheduled meets: complete results start the 24-hour hold; FINAL comes from the schedule clock.
        m.pendingSince = now;
        logChange(m, "Live source", "pending", "Every event complete: pending finalization", now);
      }
    }
    if (m.polling && m.startedAt !== null && now - m.startedAt > c.live.maxLiveHours * 3600_000 && m.pendingSince == null) {
      m.polling = false; m.nextSyncAt = null;
      m.sourceError = `Live scoring paused after ${c.live.maxLiveHours} hours. Mark it final or restart live scoring.`;
    }
    if (m.polling) m.nextSyncAt = now + c.live.pollSeconds * 1000;
    return { changed: changed || final, error: null, state: changed || before !== `${m.status}|${m.polling}|${m.sourceError ?? ""}` };
  }

  async onAlarm(): Promise<void> {
    const c = await this.config();
    const now = Date.now();
    const sync: string[] = [];
    let state = false;
    for (const m of c.meets) {
      // Stage 2 schedule clock for the Main League's scheduled meets (start → pending → final after the 24-hour hold).
      const step = scheduleTick(m, now);
      if (step === "pending") {
        m.pendingSince = Math.min(now, m.endAt ?? now);
        logChange(m, "Schedule", "pending", "Meet ended: pending finalization (held at least 24 hours)", now);
        c.audit.push({ at: now, actorId: "schedule", actorName: "Schedule", action: "meet.pending", detail: `${m.name}: pending finalization` });
        state = true;
      } else if (step === "final") {
        m.status = "FINAL"; m.polling = false; m.nextSyncAt = null; m.finalAt = now; m.correcting = null;
        logChange(m, "Schedule", "final", "24-hour hold passed with complete results: final", now);
        c.audit.push({ at: now, actorId: "schedule", actorName: "Schedule", action: "meet.final", detail: `${m.name}: final after the 24-hour hold` });
        sync.push(m.id);
        state = true;
      }
    }
    for (const m of c.meets) {
      if (!m.polling || m.nextSyncAt === null || m.nextSyncAt > now + 1000) continue;
      try {
        const r = await this.pollMeet(c, m);
        if (r.changed) sync.push(m.id);
        if (r.state) state = true;
      } catch (e) {
        console.error("global poll failed", String(e));
        m.nextSyncAt = now + 30_000;
      }
    }
    if (sync.length > 0 || state || now - this.lastPushAt > 60_000) {
      await this.saveConfig(c, null);
      this.pushConfig(c, sync);
    } else {
      await this.ctx.storage.put("globalConfig", c);
      await this.scheduleGlobalAlarm();
    }
  }

  /**
   * The platform commissioner: controls universal scoring, scoring history, results integrations, identity conflicts and
   * league oversight. Stage 3 separates it from "whoever commissions the Main League": the first time this runs it pins
   * the Main League's current commissioner (the same person as before, so nothing changes for them), and from then on
   * only `transferPlatformRole` moves it. Never taken from a client.
   */
  private async mainCommissioner(c: GlobalConfig): Promise<string> {
    if (c.platformPinned && c.mainCommissionerId) return c.mainCommissionerId;
    if (!c.mainLeagueId) return "";
    const r = await this.leagueFetch(c.mainLeagueId, "/global-whois");
    if (!r.ok) return "";
    const id = String(((await r.json()) as { commissionerId?: string }).commissionerId ?? "");
    c.mainCommissionerId = id;
    if (id) {
      c.platformPinned = true;
      c.audit.push({ at: Date.now(), actorId: "system", actorName: "System", action: "platform.pin", detail: "Platform commissioner role separated from the Main League commissioner (same account)." });
      await this.ctx.storage.put("globalConfig", c);
      this.cfg = c;
    }
    return id;
  }

  private gerr(message: string, status = 400): Response {
    return Response.json({ error: message }, { status });
  }

  /** Every global change goes through here: server-side permission check, validate, save, push to all leagues. */
  private async globalAction(user: GUser, action: Record<string, unknown>, via: string | null): Promise<Response> {
    const c = await this.config();
    const type = String(action.type ?? "");
    if (["setMainLeague", "changeMainLeague", "setMainLeagueId", "unsetMainLeague"].includes(type) || action.mainLeagueId !== undefined || action.isMainLeague !== undefined) {
      return this.gerr("The Main League is fixed and can't be changed.", 403);
    }
    if (!c.mainLeagueId) return this.gerr(`The Main League (${MAIN_LEAGUE_CODE}) wasn't found, so global settings can't be changed.`, 403);
    if (via && via !== c.mainLeagueId) return this.gerr("This is set by the Main League. Only the Main League commissioner can change it.", 403);
    const commish = await this.mainCommissioner(c);
    if (!commish || commish !== user.id) return this.gerr("Only the platform commissioner can change global settings.", 403);

    const now = Date.now();
    const str = (k: string): string => String(action[k] ?? "").trim();
    const season = new Date().getFullYear();
    const audit = (a: string, detail: string): void => { c.audit.push({ at: now, actorId: user.id, actorName: user.name, action: a, detail: detail.slice(0, 600) }); };
    const meet = (): Meet => {
      const m = c.meets.find((x) => x.id === str("meetId"));
      if (!m) throw new GlobalError("Meet not found.");
      return m;
    };
    let scoring = false;
    const sync: string[] = [];
    let extra: Record<string, unknown> = {};
    try {
      switch (type) {
        case "updateGlobalSettings": {
          const raw = (action.settings && typeof action.settings === "object" ? action.settings : action) as Record<string, unknown>;
          const next = cleanSettings(raw, c.settings);
          const diff = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== c.settings[k]);
          if (diff.length === 0) break;
          audit("settings", diff.map((k) => `${k}: ${String(c.settings[k])} → ${String(next[k])}`).join(", "));
          c.settings = next;
          break;
        }
        case "updateScoring": {
          const cur = currentRules(c);
          const next = cleanScoring({ ...cur, ...((action.rules ?? {}) as Record<string, unknown>) }, cur);
          if (JSON.stringify(next) === JSON.stringify(cur)) break;
          const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
          await this.ctx.storage.put(`snapshot:config:${now}`, c);
          const version = c.scoringVersion + 1;
          c.rules.push({ since: now, rules: next, version, by: user.name });
          if (c.rules.length > 200) c.rules = c.rules.slice(-200);
          audit("scoring", `v${version}: ${changed.map((k) => `${k}: ${JSON.stringify(cur[k])} → ${JSON.stringify(next[k])}`).join(", ")}`);
          scoring = true;
          break;
        }
        case "restorePoint": {
          // Restores the tables and scoring rules saved right before a bulk change, as a NEW version (history is kept).
          const rp = await this.ctx.storage.get<{ at: number; label: string; config: GlobalConfig }>("restorepoint:tablesV2");
          if (!rp) throw new GlobalError("No restore point is saved.");
          if (action.list === true) return Response.json({ ok: true, restorePoints: [{ id: "tablesV2", at: rp.at, label: rp.label }] });
          if (str("confirm") !== "RESTORE") throw new GlobalError("Type RESTORE to confirm.");
          await this.ctx.storage.put(`snapshot:config:${now}`, c);
          const old = normalizeConfig(structuredClone(rp.config));
          c.tableVersion = (c.tableVersion ?? 1) + 1;
          // Exactly the rows the restore point had (same windows, so the same weeks score the same way again). Rows added
          // since are kept for the record but never apply (until 0).
          const had = new Set(old.performance.map((p) => p.id));
          c.performance = [...old.performance, ...c.performance.filter((p) => !had.has(p.id)).map((p) => ({ ...p, until: 0 }))];
          const version = c.scoringVersion + 1;
          c.rules.push({ since: now, rules: currentRules(old), version, by: user.name });
          c.tableLog = [...(c.tableLog ?? []), { at: now, version: c.tableVersion, by: user.name, detail: `Restored: ${rp.label}` }].slice(-200);
          audit("restore", `Restored "${rp.label}" as tables v${c.tableVersion} / scoring v${version}`);
          scoring = true;
          break;
        }
        case "validateTable": {
          const tiers = (Array.isArray(action.tiers) ? (action.tiers as Record<string, unknown>[]) : []).map((t) => ({ mark: String(t.mark ?? ""), points: Number(t.points) }));
          return Response.json({ ok: true, problems: validateTable(str("event"), tiers) });
        }
        case "setStandard": {
          const r = setStandardRows(c.standards, action, season, now);
          c.standards = r.rows;
          audit("standard", r.label);
          scoring = true;
          break;
        }
        case "toggleStandard": {
          const r = toggleStandardRow(c.standards, str("id"), action.active === true, now);
          c.standards = r.rows;
          audit("standard", r.label);
          scoring = true;
          break;
        }
        case "setPerformanceTable": {
          const tiers = (Array.isArray(action.tiers) ? (action.tiers as Record<string, unknown>[]) : []).map((t) => ({ mark: String(t.mark ?? ""), points: Number(t.points) }));
          const problems = tiers.length > 0 ? validateTable(str("event"), tiers) : [];
          if (problems.length > 0) throw new GlobalError(`Table not saved: ${problems.join(" ")}`);
          await this.ctx.storage.put(`snapshot:config:${now}`, c);
          c.tableVersion = (c.tableVersion ?? 1) + 1;
          const r = setPerformanceRows(c.performance, action, season, now, c.tableVersion);
          c.performance = r.rows;
          c.tableLog = [...(c.tableLog ?? []), { at: now, version: c.tableVersion, by: user.name, detail: r.label }].slice(-200);
          audit("performance.table", `tables v${c.tableVersion}: ${r.label}`);
          scoring = true;
          break;
        }
        case "transferPlatformRole": {
          if (str("confirm") !== "TRANSFER") throw new GlobalError("Type TRANSFER to confirm.");
          const target = this.account(str("email").toLowerCase());
          if (!target) throw new GlobalError("No account uses that email.");
          if (target.id === user.id) throw new GlobalError("You already hold the platform commissioner role.");
          c.mainCommissionerId = target.id;
          c.platformPinned = true;
          audit("platform.transfer", `Platform commissioner role: ${user.name} (${user.id}) → ${target.name} (${target.id})`);
          break;
        }
        case "updateRoster": {
          c.roster = cleanRoster((action.roster ?? action) as Record<string, unknown>, c.roster);
          audit("roster", JSON.stringify(c.roster));
          break;
        }
        case "updateLive": {
          c.live = cleanLive((action.live ?? action) as Record<string, unknown>, c.live);
          audit("live", JSON.stringify(c.live));
          break;
        }
        case "updateNotices": {
          c.notices = cleanNotices((action.notices ?? action) as Record<string, unknown>, c.notices);
          audit("notices", JSON.stringify(c.notices));
          break;
        }
        case "createMeet": {
          if (c.meets.length >= 80) throw new GlobalError("Too many meets. Delete an old one first.");
          const m = blankGlobalMeet(crypto.randomUUID().replace(/-/g, "").slice(0, 12), 1, now);
          applyMeetFields(m, action, 30);
          if (m.provider === "ATHLETICLIVE" && m.sourceUrl && !m.resultsUrl && !m.sourceMeetId) await this.resolveGlobal(m);
          await this.storeManualFeed(m, action);
          c.meets.push(m);
          audit("meet.create", `${m.name} (Week ${m.week}, ${m.provider})`);
          extra = { meetId: m.id };
          break;
        }
        case "updateMeet": {
          const m = meet();
          const before = `${m.name} W${m.week} ${m.provider} ${m.sourceUrl ?? ""} ${m.resultsUrl}`;
          applyMeetFields(m, action, 30);
          if (m.provider === "ATHLETICLIVE" && m.sourceUrl && !m.resolve && action.sourceUrl !== undefined && action.resultsUrl === undefined) await this.resolveGlobal(m);
          if (await this.storeManualFeed(m, action)) { m.feedHash = undefined; if (m.status !== "UPCOMING") { const r = await this.pollMeet(c, m); if (r.changed) sync.push(m.id); } }
          audit("meet.update", `${before} → ${m.name} W${m.week} ${m.provider} ${m.sourceUrl ?? ""} ${m.resultsUrl}`);
          break;
        }
        case "reprocessMeet": {
          // Every league rebuilds this meet's results from the stored feed. Results are replaced by stable id, never added.
          const m = meet();
          if (m.provider !== "MANUAL") {
            const r = await this.pollMeet(c, m, m.status === "FINAL");
            if (r.error) audit("meet.reprocess", `${m.name}: source check failed (${r.error}); reprocessing the last stored copy`);
          }
          m.reprocessAt = now;
          sync.push(m.id);
          audit("meet.reprocess", `Reprocessed ${m.name} in every league`);
          break;
        }
        case "pauseAllLive": {
          const live = c.meets.filter((m) => m.polling);
          for (const m of live) { m.polling = false; m.nextSyncAt = null; }
          audit("live.pauseAll", `Paused live scoring for every league (${live.map((m) => m.name).join(", ") || "nothing was live"})`);
          extra = { paused: live.map((m) => m.id) };
          break;
        }
        case "resumeAllLive": {
          const back = c.meets.filter((m) => m.status === "LIVE" && !m.polling);
          for (const m of back) { m.polling = true; m.failures = 0; m.nextSyncAt = now; m.startedAt = m.startedAt ?? now; }
          audit("live.resumeAll", `Resumed live scoring (${back.map((m) => m.name).join(", ") || "no live meets"})`);
          break;
        }
        case "deleteMeet": {
          const m = meet();
          if (m.polling) throw new GlobalError("Stop live scoring first.");
          if ((m.syncCount > 0 || m.status !== "UPCOMING") && action.removeScores !== true) {
            throw new GlobalError(`${m.name} may already have scored results in leagues. Confirm removing its scores to delete it.`);
          }
          c.meets = c.meets.filter((x) => x.id !== m.id);
          await this.ctx.storage.delete([`gfeed:${m.id}:events`, `gfeed:${m.id}:roster`, `gfeed:${m.id}:results`]);
          audit("meet.delete", m.name);
          break;
        }
        case "resolveMeet": {
          const m = meet();
          if (action.sourceUrl !== undefined) applyMeetFields(m, { sourceUrl: action.sourceUrl }, 30);
          if (!m.sourceUrl) throw new GlobalError("Paste the meet's AthleticLIVE link first.");
          await this.resolveGlobal(m);
          audit("meet.resolve", `${m.name}: ${m.resolve?.ok ? "resolved" : "not resolved"} — ${m.resolve?.message ?? ""}`);
          break;
        }
        case "startLive": {
          const m = meet();
          if (m.lifecycle) throw new GlobalError(m.lifecycle === "INTERRUPTED" ? `${m.name} is interrupted. Use Resume.` : `${m.name} is ${m.lifecycle === "POSTPONED" ? "postponed" : "canceled"}. Reschedule it first.`);
          if (m.provider === "ATHLETICLIVE" && !m.resultsUrl && !m.sourceMeetId && m.sourceUrl) await this.resolveGlobal(m);
          if (m.provider === "ATHLETICLIVE" && !m.resultsUrl && !m.sourceMeetId) throw new GlobalError(m.resolve && !m.resolve.ok ? m.resolve.message : "Add the meet's AthleticLIVE link, then test the connection.");
          m.status = "LIVE"; m.polling = true; m.startedAt = m.startedAt ?? now; m.finalAt = null; m.failures = 0;
          m.nextSyncAt = now;
          const r = await this.pollMeet(c, m);
          sync.push(m.id);
          audit("meet.live", `Started live scoring: ${m.name}${r.error ? ` (source: ${r.error})` : ""}`);
          break;
        }
        case "stopLive": {
          const m = meet();
          m.polling = false; m.nextSyncAt = null;
          audit("meet.stop", `Stopped live scoring: ${m.name}`);
          break;
        }
        case "syncMeet": {
          const m = meet();
          const r = await this.pollMeet(c, m);
          if (r.error) {
            await this.saveConfig(c, user);
            this.pushConfig(c, []);
            return this.gerr(`LIVE SOURCE UNAVAILABLE — ${r.error} Existing scores were kept.`);
          }
          sync.push(m.id);
          break;
        }
        case "markFinal": {
          const m = meet();
          const gate = finalGate(m, action, now);
          if (gate.error) throw new GlobalError(gate.error);
          if (gate.pending) {
            m.pendingSince = now;
            logChange(m, user.name, "pending", "Commissioner ended the meet: pending finalization", now);
            audit("meet.pending", `${m.name}: pending finalization (24-hour hold)`);
            break;
          }
          if (gate.forced) { logChange(m, user.name, "final-forced", `Finalized with incomplete results — ${str("reason")}`, now); audit("meet.final.forced", `${m.name}: incomplete results; reason: ${str("reason")}`); }
          m.status = "FINAL"; m.polling = false; m.nextSyncAt = null; m.finalAt = now; m.correcting = null;
          const r = await this.pollMeet(c, m, true);
          sync.push(m.id);
          audit("meet.final", `Marked final: ${m.name}${r.error ? ` (last source check failed: ${r.error})` : ""}`);
          extra = { warning: r.error };
          break;
        }
        case "reopenMeet": {
          const m = meet();
          const wasFinal = m.status === "FINAL";
          if (wasFinal && isScheduled(m) && !str("reason")) throw new GlobalError("Give a reason for correcting a final meet.");
          m.status = isScheduled(m) && wasFinal ? "LIVE" : "UPCOMING"; m.finalAt = null;
          if (isScheduled(m)) { m.correcting = wasFinal ? now : null; if (!wasFinal) m.pendingSince = null; }
          if (wasFinal) logChange(m, user.name, "correction", `Reopened for a correction${str("reason") ? ` — ${str("reason")}` : ""}`, now);
          audit(wasFinal ? "meet.correction" : "meet.reopen", `Reopened ${m.name}${wasFinal ? ` for a correction${str("reason") ? `: ${str("reason")}` : ""}` : ""}`);
          break;
        }
        case "meetLifecycle": {
          const m = meet();
          const op = str("op");
          const r = applyLifecycle(m, op, action, user.name, now);
          if (r.error) throw new GlobalError(r.error);
          if (r.resumePolling && m.provider === "ATHLETICLIVE" && (m.resultsUrl || m.sourceMeetId)) { m.polling = true; m.failures = 0; m.nextSyncAt = now; }
          audit(`meet.${op}`, `${m.name}: ${r.detail}`);
          extra = { lifecycle: { op, clearLocks: r.clearLocks, closeWeek: r.closeWeek, detail: r.detail } };
          break;
        }
        case "setMeetTest": {
          const m = meet();
          const t = (action.test ?? {}) as Record<string, unknown>;
          m.lastTest = { at: now, ok: t.ok === true, message: String(t.message ?? t.error ?? "").slice(0, 300), results: Number(t.results ?? 0) || 0, matched: Number(t.matched ?? 0) || 0 };
          break;
        }
        default:
          return this.gerr("Unknown global setting.");
      }
    } catch (e) {
      if (e instanceof GlobalError) return this.gerr(e.message);
      throw e;
    }
    await this.saveConfig(c, user, scoring);
    this.pushConfig(c, sync);
    return Response.json({ ok: true, config: this.publicConfig(c), sync, ...extra });
  }

  /** Public link → verified source. AthleticLIVE meets are read directly; a timer folder fills the Advanced links. */
  private async resolveGlobal(m: Meet): Promise<void> {
    const r = await checkSource(m.sourceUrl ?? "", { date: m.date || undefined, name: m.name });
    m.resolve = { ok: r.ok, kind: r.kind, message: r.message, at: Date.now() };
    if (r.kind === "athleticlive") {
      m.sourceMeetId = r.ok ? r.meetId : null;
      m.sourceInfo = r.ok && r.meta ? { name: r.meta.name, date: r.meta.date, location: r.meta.location, timer: r.meta.timer, url: m.sourceUrl ?? "" } : null;
      if (r.ok && r.meta && !m.date) m.date = r.meta.date;
    } else if (r.ok) {
      m.sourceMeetId = null;
      m.eventsUrl = r.eventsUrl; m.rosterUrl = r.rosterUrl; m.resultsUrl = r.resultsUrl;
    }
  }

  private async storeManualFeed(m: Meet, a: Record<string, unknown>): Promise<boolean> {
    if (typeof a.feedResults !== "string" && typeof a.feedRoster !== "string" && typeof a.feedEvents !== "string") return false;
    const cur = await this.getFeed(m.id);
    await this.putFeed(m.id, {
      events: typeof a.feedEvents === "string" ? a.feedEvents : cur.events,
      roster: typeof a.feedRoster === "string" ? a.feedRoster : cur.roster,
      results: typeof a.feedResults === "string" ? a.feedResults : cur.results,
    });
    return true;
  }

  private async globalRoutes(request: Request, url: URL): Promise<Response | null> {
    if (request.method === "GET" && url.pathname === "/platform-holder") {
      return Response.json({ userId: await this.mainCommissioner(await this.config()) });
    }
    if (request.method === "GET" && url.pathname === "/global-config") {
      const c = await this.config();
      return Response.json({ config: this.publicConfig(c) });
    }
    if (request.method === "POST" && url.pathname === "/projection-history-reset") {
      // The Main League changed its projection meets: drop the cached copy so the next league refresh reloads it.
      await this.ctx.storage.delete("projhistory:data");
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/projection-history") {
      // The Main League's verified results, shared with every league for PROJECTIONS ONLY (cached ~30 min).
      const c = await this.config();
      const cached = await this.ctx.storage.get<{ at: number; data: { results: unknown[] } }>("projhistory:data");
      if (cached && cached.data.results.length > 0 && Date.now() - cached.at < 30 * 60_000) return Response.json(cached.data);
      if (!c.mainLeagueId) return Response.json({ at: 0, results: [], pbs: {} });
      try {
        const r = await this.leagueFetch(c.mainLeagueId, "/projection-history");
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = (await r.json()) as { at: number; results: { athleteIds: string[]; date: string }[]; pbs: Record<string, unknown> };
        const dates = data.results.map((x) => x.date).sort();
        await this.ctx.storage.put("projhistory:data", { at: Date.now(), data });
        await this.ctx.storage.put("projhistory:stats", { at: Date.now(), results: data.results.length, athletes: new Set(data.results.flatMap((x) => x.athleteIds)).size, pbAthletes: Object.keys(data.pbs).length, earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null });
        return Response.json(data);
      } catch (e) {
        console.warn("projection history fetch failed", String(e));
        return Response.json(cached?.data ?? { at: 0, results: [], pbs: {} });
      }
    }
    if (request.method === "GET" && url.pathname === "/global-feed") {
      return Response.json(await this.getFeed(url.searchParams.get("meetId") ?? ""));
    }
    if (request.method === "POST" && url.pathname === "/global-action") {
      const b = (await request.json()) as { user?: GUser; action?: Record<string, unknown>; via?: string | null };
      if (!b.user?.id) return this.gerr("Sign in again.", 401);
      return this.globalAction(b.user, b.action ?? {}, b.via ?? null);
    }
    if (request.method === "GET" && url.pathname === "/global-leagues") {
      const c = await this.config();
      const userId = url.searchParams.get("userId") ?? "";
      const commish = await this.mainCommissioner(c);
      if (!commish || commish !== userId) return this.gerr("Only the Main League commissioner can see every league.", 403);
      const rows = this.ctx.storage.sql.exec<{ league_id: string; name: string; code: string; created_at: number; version: number | null; phase: string | null; shape_pending: number | null; at: number | null }>(
        `SELECT l.league_id, l.name, l.code, l.created_at, s.version, s.phase, s.shape_pending, s.at FROM leagues l LEFT JOIN league_sync s ON s.league_id = l.league_id ORDER BY l.created_at`,
      ).toArray();
      return Response.json({
        version: c.version,
        leagues: rows.map((r) => ({
          leagueId: r.league_id, name: r.name, code: r.code, isMainLeague: r.league_id === c.mainLeagueId, version: r.version ?? 0,
          upToDate: (r.version ?? 0) >= c.version, phase: r.phase ?? "", shapePending: r.shape_pending === 1, syncedAt: r.at ?? null,
        })),
      });
    }
    if (request.method === "GET" && url.pathname === "/global-tables-report") {
      await this.config();
      return Response.json({
        report: (await this.ctx.storage.get("report:tablesV2")) ?? null, error: this.meta("official_tables_v2") ? null : (this.meta("official_tables_v2_error") ?? null),
        history: (await this.ctx.storage.get("projhistory:stats")) ?? null,
        restorePoint: await (async () => {
          const rp = await this.ctx.storage.get<{ at: number; label: string; config: GlobalConfig }>("restorepoint:tablesV2");
          return rp ? { at: rp.at, label: rp.label, performanceRows: rp.config.performance.length, scoringVersion: rp.config.scoringVersion, tableVersion: rp.config.tableVersion ?? 1 } : null;
        })(),
      });
    }
    if (request.method === "GET" && url.pathname === "/global-status") {
      const c = await this.config();
      const mains = this.ctx.storage.sql.exec<{ league_id: string }>("SELECT league_id FROM leagues WHERE code = ?", MAIN_LEAGUE_CODE).toArray();
      return Response.json({
        mainLeagueId: c.mainLeagueId, mainLeagueCode: MAIN_LEAGUE_CODE, storedMainLeagueId: this.meta("main_league_id"), leaguesWithMainCode: mains.length,
        version: c.version, scoringVersion: c.scoringVersion, meets: c.meets.length, standards: liveRows(c.standards).length, performance: liveRows(c.performance).length,
      });
    }
    return null;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pool = await this.poolRoutes(request, url);
    if (pool) return pool;
    const g = await this.globalRoutes(request, url);
    if (g) return g;

    if (request.method === "GET" && url.pathname === "/secret") {
      let secret = await this.ctx.storage.get<string>("sessionSecret");
      if (!secret) {
        secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
        await this.ctx.storage.put("sessionSecret", secret);
      }
      return Response.json({ secret });
    }

    // MARK: Accounts

    if (request.method === "POST" && url.pathname === "/signup") {
      const b = (await request.json()) as { email?: string; password?: string; name?: string };
      const email = (b.email ?? "").trim().toLowerCase();
      const password = b.password ?? "";
      const name = (b.name ?? "").trim().slice(0, 32);
      if (!EMAIL_RE.test(email) || email.length > 120) return err("Enter a valid email address.");
      if (password.length < 8) return err("Use a password with at least 8 characters.");
      if (password.length > 200) return err("That password is too long.");
      if (!name) return err("Enter your name.");
      if (this.account(email)) return err("An account with that email already exists. Sign in instead.", 409);
      const { hash, salt } = await hashPassword(password);
      const id = `u${crypto.randomUUID().replace(/-/g, "").slice(0, 23)}`;
      this.ctx.storage.sql.exec(
        "INSERT INTO accounts (id, email, name, hash, salt, prefs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id, email, name, hash, salt, JSON.stringify(DEFAULT_PREFS), Date.now(),
      );
      const a = this.accountById(id) as AccountRow;
      return Response.json({ user: this.publicUser(a), prefs: DEFAULT_PREFS });
    }

    if (request.method === "POST" && url.pathname === "/login") {
      const b = (await request.json()) as { email?: string; password?: string };
      const email = (b.email ?? "").trim().toLowerCase();
      const a = this.account(email);
      if (!a) return err("Email or password is incorrect.", 401);
      const now = Date.now();
      if (a.locked_until > now) return err("Too many attempts. Try again in a few minutes, or reset your password.", 429);
      const { hash } = await hashPassword(b.password ?? "", a.salt);
      if (!safeEqual(hash, a.hash)) {
        const failed = a.failed + 1;
        this.ctx.storage.sql.exec("UPDATE accounts SET failed = ?, locked_until = ? WHERE id = ?", failed >= 8 ? 0 : failed, failed >= 8 ? now + 10 * 60_000 : 0, a.id);
        return err("Email or password is incorrect.", 401);
      }
      this.ctx.storage.sql.exec("UPDATE accounts SET failed = 0, locked_until = 0 WHERE id = ?", a.id);
      return Response.json({ user: this.publicUser(a), prefs: cleanPrefs(JSON.parse(a.prefs || "{}")) });
    }

    if (request.method === "POST" && url.pathname === "/reset-request") {
      const b = (await request.json()) as { email?: string };
      const email = (b.email ?? "").trim().toLowerCase();
      const a = this.account(email);
      if (!a) return Response.json({ code: null });
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] as number) % 900000);
      const { hash, salt } = await hashPassword(code);
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO resets (email, code_hash, salt, expires, attempts) VALUES (?, ?, ?, ?, 0)",
        email, hash, salt, Date.now() + RESET_MS,
      );
      return Response.json({ code, name: a.name, id: a.id });
    }

    if (request.method === "POST" && url.pathname === "/reset-confirm") {
      const b = (await request.json()) as { email?: string; code?: string; password?: string };
      const email = (b.email ?? "").trim().toLowerCase();
      const row = this.ctx.storage.sql.exec<{ code_hash: string; salt: string; expires: number; attempts: number }>("SELECT * FROM resets WHERE email = ?", email).toArray()[0];
      const a = this.account(email);
      if (!row || !a || row.expires < Date.now() || row.attempts >= 5) return err("That code has expired. Request a new one.");
      const { hash } = await hashPassword((b.code ?? "").trim(), row.salt);
      if (!safeEqual(hash, row.code_hash)) {
        this.ctx.storage.sql.exec("UPDATE resets SET attempts = attempts + 1 WHERE email = ?", email);
        return err("That code isn't right.");
      }
      const password = b.password ?? "";
      if (password.length < 8) return err("Use a password with at least 8 characters.");
      const next = await hashPassword(password);
      this.ctx.storage.sql.exec("UPDATE accounts SET hash = ?, salt = ?, failed = 0, locked_until = 0 WHERE id = ?", next.hash, next.salt, a.id);
      this.ctx.storage.sql.exec("DELETE FROM resets WHERE email = ?", email);
      return Response.json({ user: this.publicUser(a), prefs: cleanPrefs(JSON.parse(a.prefs || "{}")) });
    }

    if (request.method === "GET" && url.pathname === "/account") {
      const a = this.accountById(url.searchParams.get("id") ?? "");
      if (!a) return err("Account not found.", 401);
      return Response.json({ user: this.publicUser(a), prefs: cleanPrefs(JSON.parse(a.prefs || "{}")) });
    }

    if (request.method === "POST" && url.pathname === "/account") {
      const b = (await request.json()) as { id?: string; name?: string; prefs?: unknown };
      const a = this.accountById(b.id ?? "");
      if (!a) return err("Account not found.", 401);
      const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 32) : a.name;
      const prefs = b.prefs !== undefined ? cleanPrefs(b.prefs) : cleanPrefs(JSON.parse(a.prefs || "{}"));
      this.ctx.storage.sql.exec("UPDATE accounts SET name = ?, prefs = ? WHERE id = ?", name, JSON.stringify(prefs), a.id);
      return Response.json({ user: { id: a.id, name, email: a.email }, prefs });
    }

    // Owner-only password change: the current password must be right. Other sessions stop working (see /account).
    if (request.method === "POST" && url.pathname === "/change-password") {
      const b = (await request.json()) as { id?: string; current?: string; password?: string };
      const a = this.accountById(b.id ?? "");
      if (!a) return err("Account not found.", 401);
      const now = Date.now();
      if (a.locked_until > now) return err("Too many attempts. Try again in a few minutes.", 429);
      const { hash } = await hashPassword(b.current ?? "", a.salt);
      if (!safeEqual(hash, a.hash)) {
        const failed = a.failed + 1;
        this.ctx.storage.sql.exec("UPDATE accounts SET failed = ?, locked_until = ? WHERE id = ?", failed >= 8 ? 0 : failed, failed >= 8 ? now + 10 * 60_000 : 0, a.id);
        return err("Your current password isn't right.", 400);
      }
      const password = b.password ?? "";
      if (password.length < 8) return err("Use a password with at least 8 characters.");
      if (password.length > 200) return err("That password is too long.");
      const next = await hashPassword(password);
      this.ctx.storage.sql.exec("UPDATE accounts SET hash = ?, salt = ?, failed = 0, locked_until = 0, pw_changed_at = ? WHERE id = ?", next.hash, next.salt, now, a.id);
      return Response.json({ user: this.publicUser(a), prefs: cleanPrefs(JSON.parse(a.prefs || "{}")), changedAt: now });
    }

    // Session check: a token issued before the last password change is no longer valid.
    if (request.method === "GET" && url.pathname === "/session-ok") {
      const a = this.accountById(url.searchParams.get("id") ?? "");
      const iat = Number(url.searchParams.get("iat") ?? "0") * 1000;
      if (!a) return Response.json({ ok: false });
      const changed = (a as AccountRow & { pw_changed_at?: number }).pw_changed_at ?? 0;
      return Response.json({ ok: !changed || iat + 1000 >= changed });
    }

    if (request.method === "POST" && url.pathname === "/delete-account") {
      const b = (await request.json()) as { id?: string };
      const a = this.accountById(b.id ?? "");
      if (!a) return err("Account not found.", 404);
      this.ctx.storage.sql.exec("DELETE FROM accounts WHERE id = ?", a.id);
      this.ctx.storage.sql.exec("DELETE FROM resets WHERE email = ?", a.email);
      this.ctx.storage.sql.exec("DELETE FROM memberships WHERE user_id = ?", a.id);
      this.ctx.storage.sql.exec("DELETE FROM hidden WHERE user_id = ?", a.id);
      this.ctx.storage.sql.exec("DELETE FROM push_devices WHERE user_id = ?", a.id);
      return Response.json({ ok: true });
    }

    // MARK: Push devices (one row per OneSignal push subscription; a subscription belongs to exactly one account)

    if (request.method === "POST" && url.pathname === "/push-device") {
      const b = (await request.json()) as Record<string, unknown>;
      const userId = String(b.userId ?? "");
      const subId = String(b.subscriptionId ?? "").slice(0, 64);
      if (!this.accountById(userId)) return err("Account not found.", 401);
      if (!/^[0-9a-fA-F-]{20,64}$/.test(subId)) return err("Missing push subscription id.");
      const s = (k: string, n = 80): string => String(b[k] ?? "").slice(0, n);
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO push_devices (sub_id, user_id, onesignal_id, token_tail, has_token, permission, opted_in, environment, app_version, device, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        subId, userId, s("onesignalId", 64), s("tokenTail", 16), b.hasToken === true ? 1 : 0, s("permission", 20), b.optedIn === true ? 1 : 0,
        s("environment", 40), s("appVersion", 40), s("device", 60), Date.now(),
      );
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/push-device-remove") {
      const b = (await request.json()) as { subIds?: string[]; userId?: string };
      for (const id of (b.subIds ?? []).slice(0, 50)) this.ctx.storage.sql.exec("DELETE FROM push_devices WHERE sub_id = ?", id);
      if (b.userId && !b.subIds) this.ctx.storage.sql.exec("DELETE FROM push_devices WHERE user_id = ?", b.userId);
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/push-devices") {
      const b = (await request.json()) as { ids?: string[] };
      const out: Record<string, Record<string, unknown>[]> = {};
      for (const id of (b.ids ?? []).slice(0, 60)) {
        out[id] = this.ctx.storage.sql.exec<Record<string, unknown>>("SELECT * FROM push_devices WHERE user_id = ? ORDER BY updated_at DESC", id).toArray()
          .map((r) => ({ subscriptionId: r.sub_id, onesignalId: r.onesignal_id, tokenTail: r.token_tail, hasToken: r.has_token === 1, permission: r.permission, optedIn: r.opted_in === 1, environment: r.environment, appVersion: r.app_version, device: r.device, updatedAt: r.updated_at }));
      }
      return Response.json({ devices: out });
    }

    if (request.method === "POST" && url.pathname === "/prefs-bulk") {
      const b = (await request.json()) as { ids?: string[] };
      const ids = (b.ids ?? []).slice(0, 50);
      const out: Record<string, Prefs> = {};
      for (const id of ids) {
        const a = this.accountById(id);
        out[id] = a ? cleanPrefs(JSON.parse(a.prefs || "{}")) : DEFAULT_PREFS;
      }
      return Response.json({ prefs: out });
    }

    // MARK: Leagues

    if (request.method === "POST" && url.pathname === "/reserve") {
      const { leagueId, name } = (await request.json()) as { leagueId: string; name: string };
      for (let attempt = 0; attempt < 20; attempt++) {
        const code = this.makeCode();
        const exists = this.ctx.storage.sql.exec("SELECT 1 FROM leagues WHERE code = ?", code).toArray().length > 0;
        if (exists) continue;
        this.ctx.storage.sql.exec(
          "INSERT INTO leagues (league_id, code, name, created_at) VALUES (?, ?, ?, ?)",
          leagueId, code, name, Date.now(),
        );
        return Response.json({ code });
      }
      return Response.json({ error: "Could not create an invite code." }, { status: 500 });
    }

    if (request.method === "GET" && url.pathname === "/lookup") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length !== 6) return Response.json({ error: "Invite codes are 6 characters. Check the code and try again." }, { status: 404 });
      const row = this.ctx.storage.sql.exec<LeagueRow>("SELECT * FROM leagues WHERE code = ?", code).toArray()[0];
      if (!row) return Response.json({ error: "No league with that code. Check the code and try again." }, { status: 404 });
      return Response.json({ leagueId: row.league_id, name: row.name, code: row.code });
    }

    if (request.method === "POST" && url.pathname === "/member") {
      const { userId, leagueId } = (await request.json()) as { userId: string; leagueId: string };
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO memberships (user_id, league_id, joined_at) VALUES (?, ?, ?)",
        userId, leagueId, Date.now(),
      );
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/unmember") {
      const { userId, leagueId } = (await request.json()) as { userId: string; leagueId: string };
      this.ctx.storage.sql.exec("DELETE FROM memberships WHERE user_id = ? AND league_id = ?", userId, leagueId);
      this.ctx.storage.sql.exec("DELETE FROM hidden WHERE user_id = ? AND league_id = ?", userId, leagueId);
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/rename") {
      const { leagueId, name } = (await request.json()) as { leagueId: string; name: string };
      this.ctx.storage.sql.exec("UPDATE leagues SET name = ? WHERE league_id = ?", name, leagueId);
      return Response.json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/mine") {
      const userId = url.searchParams.get("userId") ?? "";
      const rows = this.ctx.storage.sql
        .exec<LeagueRow & { joined_at: number; hidden: number }>(
          `SELECT l.league_id, l.code, l.name, l.created_at, m.joined_at,
                  EXISTS (SELECT 1 FROM hidden h WHERE h.user_id = m.user_id AND h.league_id = m.league_id) AS hidden
           FROM memberships m JOIN leagues l ON l.league_id = m.league_id WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
          userId,
        )
        .toArray();
      const mainId = this.mainLeagueId();
      return Response.json({ mainLeagueId: mainId, leagues: rows.map((r) => ({ leagueId: r.league_id, code: r.code, name: r.name, hidden: r.hidden === 1, isMainLeague: r.league_id === mainId })) });
    }

    // Per-user "hide from Home". Only ever changes this user's row; membership is untouched.
    if (request.method === "POST" && url.pathname === "/hide") {
      const { userId, leagueId, hidden } = (await request.json()) as { userId: string; leagueId: string; hidden: boolean };
      const member = this.ctx.storage.sql.exec("SELECT 1 FROM memberships WHERE user_id = ? AND league_id = ?", userId, leagueId).toArray().length > 0;
      if (!member) return err("You're not in that league.", 404);
      if (hidden) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO hidden (user_id, league_id, hidden_at) VALUES (?, ?, ?)", userId, leagueId, Date.now());
      else this.ctx.storage.sql.exec("DELETE FROM hidden WHERE user_id = ? AND league_id = ?", userId, leagueId);
      return Response.json({ ok: true, hidden });
    }

    // League deletion: invite code, memberships, hidden prefs and co-manager invites go in one transaction.
    if (request.method === "POST" && url.pathname === "/drop-league") {
      const { leagueId } = (await request.json()) as { leagueId: string };
      if (!leagueId) return err("Missing league.");
      if (leagueId === this.mainLeagueId()) return err("The Main League can't be deleted.", 403);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM leagues WHERE league_id = ?", leagueId);
        this.ctx.storage.sql.exec("DELETE FROM memberships WHERE league_id = ?", leagueId);
        this.ctx.storage.sql.exec("DELETE FROM hidden WHERE league_id = ?", leagueId);
        this.ctx.storage.sql.exec("DELETE FROM co_invites WHERE league_id = ?", leagueId);
        this.ctx.storage.sql.exec("DELETE FROM league_sync WHERE league_id = ?", leagueId);
      });
      return Response.json({ ok: true });
    }

    // MARK: Co-manager invite codes (7 characters, separate from 6-character league codes)

    if (request.method === "POST" && url.pathname === "/co-reserve") {
      const { leagueId, teamId } = (await request.json()) as { leagueId: string; teamId: string };
      this.ctx.storage.sql.exec("DELETE FROM co_invites WHERE league_id = ? AND team_id = ?", leagueId, teamId);
      for (let attempt = 0; attempt < 20; attempt++) {
        const code = this.makeCode(7);
        if (this.ctx.storage.sql.exec("SELECT 1 FROM co_invites WHERE code = ?", code).toArray().length > 0) continue;
        this.ctx.storage.sql.exec("INSERT INTO co_invites (code, league_id, team_id, created_at) VALUES (?, ?, ?, ?)", code, leagueId, teamId, Date.now());
        return Response.json({ code });
      }
      return err("Could not create an invite code.", 500);
    }

    if (request.method === "GET" && url.pathname === "/co-lookup") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const row = this.ctx.storage.sql.exec<{ league_id: string; team_id: string }>("SELECT league_id, team_id FROM co_invites WHERE code = ?", code).toArray()[0];
      if (!row) return err("That co-manager code isn't valid anymore. Ask the manager for a new one.", 404);
      return Response.json({ leagueId: row.league_id, teamId: row.team_id, code });
    }

    if (request.method === "POST" && url.pathname === "/co-drop") {
      const { code } = (await request.json()) as { code: string };
      this.ctx.storage.sql.exec("DELETE FROM co_invites WHERE code = ?", code);
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }

  private makeCode(length = 6): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  }
}
