/**
 * Supabase Postgres link. The Worker is the only writer: every call goes through SECURITY DEFINER
 * functions guarded by a server-only secret (derived from a private env), so the mobile app never
 * holds database credentials and tables stay closed to direct client access.
 */
export type DbEnv = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  ONESIGNAL_REST_API_KEY?: string;
  TD_DB_SECRET?: string;
};

type Row = Record<string, unknown>;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class Db {
  private secret: string | null = null;
  private claimed = false;
  private claiming: Promise<boolean> | null = null;

  constructor(private env: DbEnv) {}

  get enabled(): boolean {
    return !!(this.env.EXPO_PUBLIC_SUPABASE_URL && this.env.EXPO_PUBLIC_SUPABASE_ANON_KEY && (this.env.TD_DB_SECRET || this.env.ONESIGNAL_REST_API_KEY));
  }

  private async key(): Promise<string> {
    if (this.secret) return this.secret;
    const base = this.env.TD_DB_SECRET || `fantasytf-db:${this.env.ONESIGNAL_REST_API_KEY ?? ""}`;
    this.secret = await sha256Hex(base);
    return this.secret;
  }

  private async rpc<T>(fn: string, args: Row): Promise<T> {
    const url = `${(this.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/rest/v1/rpc/${fn}`;
    const anon = this.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const res = await fetch(url, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_secret: await this.key(), ...args }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`db ${fn} ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  /** First server call registers the secret hash; later calls verify it. */
  async ensure(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.claimed) return true;
    this.claiming ??= this.rpc<boolean>("td_claim", {})
      .then((ok) => {
        this.claimed = ok === true;
        if (!this.claimed) console.warn("db secret mismatch — Supabase writes disabled");
        return this.claimed;
      })
      .finally(() => { this.claiming = null; });
    return this.claiming;
  }

  async upsert(table: string, rows: Row[]): Promise<void> {
    if (rows.length === 0 || !(await this.ensure())) return;
    for (let i = 0; i < rows.length; i += 400) {
      await this.rpc("td_upsert", { p_table: table, p_rows: rows.slice(i, i + 400) });
    }
  }

  async replace(table: string, leagueId: string, rows: Row[]): Promise<void> {
    if (!(await this.ensure())) return;
    await this.rpc("td_replace", { p_table: table, p_league: leagueId, p_rows: rows });
  }

  async remove(table: string, ids: string[]): Promise<void> {
    if (ids.length === 0 || !(await this.ensure())) return;
    await this.rpc("td_delete", { p_table: table, p_ids: ids });
  }

  async counts(leagueId: string): Promise<Row | null> {
    if (!(await this.ensure())) return null;
    return this.rpc<Row>("td_count", { p_league: leagueId });
  }
}
