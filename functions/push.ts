/**
 * OneSignal / APNs delivery helpers shared by the Worker and League objects.
 * Everything here reports the real provider answer (HTTP status, error text, APNs counts) instead of guessing.
 */

export type PushEnv = { ONESIGNAL_APP_ID?: string; ONESIGNAL_REST_API_KEY?: string };

const API = "https://api.onesignal.com";

export type OsResult = { ok: boolean; status: number; body: Record<string, unknown> };

/** Calls OneSignal with the REST key. Falls back to the legacy `Basic` scheme if the key is an old-style key. */
export async function osFetch(env: PushEnv, path: string, init: { method?: string; body?: unknown } = {}): Promise<OsResult> {
  const key = env.ONESIGNAL_REST_API_KEY ?? "";
  const run = async (scheme: string): Promise<OsResult> => {
    try {
      const r = await fetch(`${API}${path}`, {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", Authorization: `${scheme} ${key}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await r.text();
      let body: Record<string, unknown> = {};
      try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = { raw: text.slice(0, 300) }; }
      return { ok: r.ok, status: r.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: { errors: [`Network error reaching OneSignal: ${String(e).slice(0, 160)}`] } };
    }
  };
  const first = await run("Key");
  if (first.status === 401 || first.status === 403) {
    const legacy = await run("Basic");
    if (legacy.ok || legacy.status !== first.status) return legacy;
  }
  return first;
}

export function errorText(body: Record<string, unknown>): string {
  const e = body.errors;
  if (!e) return "";
  if (typeof e === "string") return e;
  if (Array.isArray(e)) return e.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ");
  return JSON.stringify(e);
}

/** What OneSignal's `notification_types` means for an iPhone (from OneSignal's subscription docs). */
export function subscriptionState(n: number | null | undefined): { ok: boolean; code: string; text: string } {
  const v = typeof n === "number" ? n : 0;
  if (v > 0) return { ok: true, code: "subscribed", text: "Subscribed. iOS permission granted and APNs token registered." };
  switch (v) {
    case 0: case -99: return { ok: false, code: "never-subscribed", text: "Never subscribed. The phone has not finished registering with APNs." };
    case -2: return { ok: false, code: "opted-out", text: "Opted out in the app." };
    case -10: return { ok: false, code: "unsubscribed", text: "Not subscribed: notifications blocked in iPhone Settings, app deleted, or APNs reported the token invalid." };
    case -13: return { ok: false, code: "missing-capability", text: "App build is missing the Push Notifications capability (no aps-environment entitlement)." };
    case -14: case -16: case -17: case -30: return { ok: false, code: "apns-error", text: `APNs registration error (${v}). The token could not be used.` };
    case -15: return { ok: false, code: "simulator", text: "Simulator. Simulators can't receive remote pushes." };
    case -18: return { ok: false, code: "never-prompted", text: "Never asked for permission. The app has to ask (Allow Notifications) first." };
    case -19: return { ok: false, code: "prompt-unanswered", text: "Permission prompt shown but never answered." };
    case -22: return { ok: false, code: "dashboard-off", text: "Unsubscribed manually in the OneSignal dashboard." };
    case -31: return { ok: false, code: "api-off", text: "Disabled through the OneSignal REST API." };
    default: return { ok: false, code: "error", text: `Not subscribed (OneSignal code ${v}).` };
  }
}

/** OneSignal `test_type`: which APNs environment the token was registered in. */
export function apnsEnvironment(testType: unknown): string {
  const t = Number(testType ?? 0);
  if (t === 1) return "development (sandbox APNs)";
  if (t === 2) return "ad hoc";
  return "production APNs";
}

export type SubInfo = {
  id: string; type: string; tokenTail: string; hasToken: boolean; enabled: boolean; notificationTypes: number; state: string; stateText: string;
  subscribed: boolean; environment: string; sdk: string; appVersion: string; deviceModel: string; deviceOs: string; sessionCount: number; lastActive: number | null;
};

export type OsUser = { found: boolean; onesignalId: string | null; subscriptions: SubInfo[]; status: number; error: string | null };

/** Looks up the OneSignal user linked to an account (external_id = account id). */
export async function viewUser(env: PushEnv, externalId: string): Promise<OsUser> {
  const r = await osFetch(env, `/apps/${env.ONESIGNAL_APP_ID}/users/by/external_id/${encodeURIComponent(externalId)}`);
  if (r.status === 404) return { found: false, onesignalId: null, subscriptions: [], status: 404, error: null };
  if (!r.ok) return { found: false, onesignalId: null, subscriptions: [], status: r.status, error: `HTTP ${r.status}: ${errorText(r.body) || JSON.stringify(r.body).slice(0, 200)}` };
  const identity = (r.body.identity ?? {}) as Record<string, unknown>;
  const props = (r.body.properties ?? {}) as Record<string, unknown>;
  const subs = ((r.body.subscriptions ?? []) as Record<string, unknown>[])
    .filter((s) => String(s.type ?? "").toLowerCase().includes("push"))
    .map((s): SubInfo => {
      const token = String(s.token ?? "");
      // Some responses omit notification_types for healthy subscriptions; an enabled sub with a token is subscribed.
      const rawNt = s.notification_types;
      const nt = typeof rawNt === "number" ? rawNt : s.enabled === true && token ? 1 : 0;
      const st = subscriptionState(nt);
      return {
        id: String(s.id ?? ""), type: String(s.type ?? ""), tokenTail: token ? `…${token.slice(-8)}` : "", hasToken: token.length > 0,
        enabled: s.enabled === true, notificationTypes: nt, state: st.code, stateText: st.text, subscribed: st.ok && s.enabled !== false && token.length > 0,
        environment: apnsEnvironment(s.test_type), sdk: String(s.sdk ?? ""), appVersion: String(s.app_version ?? ""),
        deviceModel: String(s.device_model ?? ""), deviceOs: String(s.device_os ?? ""), sessionCount: Number(s.session_count ?? 0),
        lastActive: typeof props.last_active === "number" ? (props.last_active as number) * 1000 : null,
      };
    });
  return { found: true, onesignalId: (identity.onesignal_id as string | undefined) ?? null, subscriptions: subs, status: r.status, error: null };
}

/** One-line reason a user can't receive pushes (or null if at least one device is subscribed). */
export function userProblem(u: OsUser): string | null {
  if (u.error) return `OneSignal lookup failed: ${u.error}`;
  if (!u.found) return "No OneSignal user for this account: the app has never signed in with push on any phone.";
  if (u.subscriptions.length === 0) return "Account is linked but has no push subscription: this phone never registered with APNs.";
  if (u.subscriptions.some((s) => s.subscribed)) return null;
  return u.subscriptions.map((s) => `${s.deviceModel || "device"}: ${s.stateText}`).join(" | ");
}

/** APNs said these tokens are dead (or the subscription is unusable). Never removes the phone the user is testing from. */
function isStale(s: SubInfo, keep: string | null): boolean {
  if (keep && s.id === keep) return false;
  return s.state === "apns-error" || s.state === "unsubscribed" || (!s.hasToken && s.state === "never-subscribed" && s.sessionCount === 0);
}

/** Deletes invalid/stale push subscriptions for one account. Returns the subscription ids removed. */
export async function removeStale(env: PushEnv, u: OsUser, keep: string | null): Promise<string[]> {
  const removed: string[] = [];
  // Never strip a user's last subscription unless APNs explicitly rejected it.
  for (const s of u.subscriptions.filter((x) => isStale(x, keep))) {
    if (s.state === "never-subscribed" && u.subscriptions.length <= 1) continue;
    const r = await osFetch(env, `/apps/${env.ONESIGNAL_APP_ID}/subscriptions/${encodeURIComponent(s.id)}`, { method: "DELETE" });
    if (r.ok || r.status === 404) removed.push(s.id);
  }
  return removed;
}

export type SendOutcome = { httpStatus: number; notificationId: string | null; error: string | null; invalid: string | null; raw: Record<string, unknown> };

export async function sendPush(env: PushEnv, payload: Record<string, unknown>): Promise<SendOutcome> {
  const r = await osFetch(env, "/notifications?c=push", { method: "POST", body: { app_id: env.ONESIGNAL_APP_ID, target_channel: "push", ...payload } });
  const id = typeof r.body.id === "string" && r.body.id ? r.body.id : null;
  const errs = r.body.errors;
  // On success OneSignal may still list skipped recipients as an object ({invalid_aliases: ...}).
  const invalid = id && errs && typeof errs === "object" && !Array.isArray(errs) ? JSON.stringify(errs).slice(0, 300) : null;
  const error = !r.ok ? `HTTP ${r.status}: ${errorText(r.body) || JSON.stringify(r.body).slice(0, 200)}` : id ? null : errorText(r.body) || "OneSignal accepted the request but created no notification (no subscribed devices).";
  return { httpStatus: r.status, notificationId: id, error, invalid, raw: r.body };
}

export type DeliveryStats = {
  successful: number; failed: number; errored: number; received: number | null; remaining: number; completedAt: number | null;
  ios: Record<string, number> | null; checkedAt: number;
};

/** APNs outcome for a notification: successful = accepted by APNs, failed = token unsubscribed/invalid, errored = provider error. */
export async function deliveryStats(env: PushEnv, notificationId: string): Promise<DeliveryStats | null> {
  const r = await osFetch(env, `/notifications/${encodeURIComponent(notificationId)}?app_id=${env.ONESIGNAL_APP_ID}`);
  if (!r.ok) return null;
  const b = r.body;
  const pds = (b.platform_delivery_stats ?? {}) as Record<string, Record<string, number>>;
  return {
    successful: Number(b.successful ?? 0), failed: Number(b.failed ?? 0), errored: Number(b.errored ?? 0),
    received: typeof b.received === "number" ? (b.received as number) : null, remaining: Number(b.remaining ?? 0),
    completedAt: typeof b.completed_at === "number" ? (b.completed_at as number) * 1000 : null, ios: pds.ios ?? null, checkedAt: Date.now(),
  };
}

/** Polls the APNs outcome until it settles (or the time budget runs out). */
export async function waitForStats(env: PushEnv, notificationId: string, tries = 5, gapMs = 2500): Promise<DeliveryStats | null> {
  let last: DeliveryStats | null = null;
  for (let i = 0; i < tries; i++) {
    await new Promise((res) => setTimeout(res, gapMs));
    last = await deliveryStats(env, notificationId);
    if (last && last.successful + last.failed + last.errored > 0 && last.remaining === 0) return last;
  }
  return last;
}

export function statsVerdict(s: DeliveryStats | null): { status: "delivered" | "failed" | "sent"; text: string } {
  if (!s) return { status: "sent", text: "Accepted by OneSignal; APNs outcome not reported yet." };
  if (s.successful > 0) return { status: "delivered", text: `APNs accepted it for ${s.successful} device${s.successful === 1 ? "" : "s"}${s.received ? `, ${s.received} confirmed received` : ""}${s.failed + s.errored > 0 ? ` (${s.failed} invalid token, ${s.errored} errored)` : ""}.` };
  if (s.failed + s.errored > 0) return { status: "failed", text: `APNs rejected it: ${s.failed} invalid/unsubscribed token${s.failed === 1 ? "" : "s"}, ${s.errored} provider error${s.errored === 1 ? "" : "s"}. If 'errored', check the Apple .p8 key, Team ID and bundle ID (fantasytrackapp.rork) in OneSignal.` };
  return { status: "sent", text: "Accepted by OneSignal; APNs is still processing." };
}
