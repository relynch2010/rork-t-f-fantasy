import { signSession, verifySession, type SessionUser } from "./auth";
import { osFetch, removeStale, sendPush, statsVerdict, userProblem, viewUser, waitForStats, errorText, type OsUser } from "./push";

export { League } from "./league";
export { Directory } from "./directory";

type Env = {
  DO: Fetcher;
  ONESIGNAL_APP_ID?: string;
  ONESIGNAL_REST_API_KEY?: string;
  /** Optional OneSignal Organization API key: only used to repair the app's APNs bundle id. */
  ONESIGNAL_ORG_API_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
};

type User = { id: string; name: string };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function doRequest(env: Env, cls: string, id: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Rork-DO-Class", cls);
  headers.set("X-Rork-DO-Id", id);
  if (init.body) headers.set("Content-Type", "application/json");
  return env.DO.fetch(new Request(`https://internal${path}`, { ...init, headers }));
}

async function relay(res: Response): Promise<Response> {
  return new Response(res.body, { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
}

let cachedSecret: string | null = null;

async function sessionSecret(env: Env): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const res = await doRequest(env, "Directory", "global", "/secret");
  cachedSecret = ((await res.json()) as { secret: string }).secret;
  return cachedSecret;
}

async function userFromToken(env: Env, token: string): Promise<SessionUser | null> {
  if (!token) return null;
  return verifySession(await sessionSecret(env), token);
}

const sessionChecks = new Map<string, { ok: boolean; at: number }>();

/** Tokens issued before the account's last password change stop working (checked at most once a minute per token). */
async function sessionStillValid(env: Env, token: string, userId: string): Promise<boolean> {
  const hit = sessionChecks.get(token);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  let iat = 0;
  try {
    const part = (token.split(".")[0] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    iat = Number((JSON.parse(atob(part + "===".slice((part.length + 3) % 4))) as { iat?: number }).iat ?? 0);
  } catch { iat = 0; }
  const r = await doRequest(env, "Directory", "global", `/session-ok?id=${encodeURIComponent(userId)}&iat=${iat}`).catch(() => null);
  const ok = r?.ok ? ((await r.json()) as { ok: boolean }).ok : true;
  if (sessionChecks.size > 5000) sessionChecks.clear();
  sessionChecks.set(token, { ok, at: Date.now() });
  return ok;
}

async function authed(request: Request, env: Env): Promise<SessionUser | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const u = await userFromToken(env, token);
  if (!u) return null;
  return (await sessionStillValid(env, token, u.id)) ? u : null;
}

/** Wraps a Directory account response ({user, prefs}) with a fresh session token. */
async function withSession(env: Env, res: Response): Promise<Response> {
  if (!res.ok) return relay(res);
  const body = (await res.json()) as { user: SessionUser; prefs: unknown };
  const token = await signSession(await sessionSecret(env), body.user);
  return json({ token, user: body.user, prefs: body.prefs });
}

const BUNDLE_ID = "fantasytrackapp.rork";

type Step = { step: string; ok: boolean; detail: string };

/** What OneSignal's app record says about APNs (needs an org key; reported honestly when the app key can't read it). */
async function appConfig(env: Env): Promise<Record<string, unknown>> {
  const r = await osFetch(env, `/apps/${env.ONESIGNAL_APP_ID}`);
  if (!r.ok) return { readable: false, status: r.status, note: r.status === 401 || r.status === 403 ? "The app REST key can't read the OneSignal app record (that needs an Organization key). APNs settings are verified by a real send instead." : `HTTP ${r.status}: ${errorText(r.body)}` };
  const b = r.body;
  return {
    readable: true, name: b.name ?? null, apnsEnv: b.apns_env ?? null, bundleId: b.apns_bundle_id ?? null, teamId: b.apns_team_id ?? null,
    keyId: b.apns_key_id ?? null, hasP8: !!b.apns_p8 || !!b.apns_key_id, hasCertificate: !!b.apns_certificates, bundleMatches: b.apns_bundle_id ? b.apns_bundle_id === BUNDLE_ID : null,
    players: b.players ?? null, messageablePlayers: b.messageable_players ?? null,
  };
}

async function storedDevices(env: Env, userId: string): Promise<Record<string, unknown>[]> {
  const r = await doRequest(env, "Directory", "global", "/push-devices", { method: "POST", body: JSON.stringify({ ids: [userId] }) });
  return (((await r.json()) as { devices: Record<string, Record<string, unknown>[]> }).devices[userId]) ?? [];
}

/** Full push diagnosis for the signed-in account (and, if given, this exact phone). */
async function pushStatus(env: Env, userId: string, subId: string): Promise<Record<string, unknown>> {
  const configured = !!env.ONESIGNAL_APP_ID && !!env.ONESIGNAL_REST_API_KEY;
  if (!configured) return { configured, problem: "Push is not configured on the server (OneSignal App ID or REST API key missing)." };
  const [user, devices, app] = await Promise.all([viewUser(env, userId), storedDevices(env, userId), appConfig(env)]);
  const keyValid = user.status !== 401 && user.status !== 403;
  const mine = subId ? user.subscriptions.find((s) => s.id === subId) ?? null : null;
  let problem = !keyValid ? `OneSignal rejected the server's REST API key (HTTP ${user.status}). Update ONESIGNAL_REST_API_KEY.` : userProblem(user);
  if (app.readable && app.bundleMatches === false) problem = `APNs bundle ID in OneSignal is "${String(app.bundleId)}" but the app is "${BUNDLE_ID}". Apple rejects every push until this matches.`;
  if (!problem && subId && !mine) problem = "This phone's push subscription isn't linked to your account in OneSignal yet. Reopen the app; it re-links automatically.";
  if (!problem && mine && !mine.subscribed) problem = `This phone: ${mine.stateText}`;
  return { configured, appId: env.ONESIGNAL_APP_ID, keyValid, bundleId: BUNDLE_ID, app, user, devices, thisDevice: mine, problem, checkedAt: Date.now() };
}

/** Sends a real push to the signed-in user's phone and reports every step, including APNs' own outcome. */
async function pushTest(env: Env, userId: string, name: string, subId: string): Promise<Record<string, unknown>> {
  const steps: Step[] = [];
  const done = (status: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ok: status === "delivered", status, steps, at: Date.now(), ...extra });
  if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_REST_API_KEY) {
    steps.push({ step: "Server push keys", ok: false, detail: "ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY is missing on the server." });
    return done("failed");
  }
  steps.push({ step: "Server push keys", ok: true, detail: `App ${env.ONESIGNAL_APP_ID.slice(0, 8)}… with REST key configured.` });
  const app = await appConfig(env);
  if (app.readable) {
    const okBundle = app.bundleMatches !== false;
    steps.push({
      step: "APNs configuration", ok: okBundle && app.apnsEnv === "production" && app.hasP8 === true,
      detail: `${app.hasP8 ? `.p8 key ${String(app.keyId)}` : "no .p8 key"} · team ${String(app.teamId)} · ${String(app.apnsEnv)} APNs · bundle ${String(app.bundleId)}${okBundle ? "" : ` ≠ app ${BUNDLE_ID} (Apple rejects every push)`}`,
    });
  }
  let user: OsUser = await viewUser(env, userId);
  if (user.status === 401 || user.status === 403) {
    steps.push({ step: "OneSignal REST key", ok: false, detail: `OneSignal rejected the key: ${user.error}` });
    return done("failed", { user });
  }
  steps.push({ step: "Account linked in OneSignal", ok: user.found, detail: user.found ? `external_id ${userId} → OneSignal user ${user.onesignalId ?? "?"}, ${user.subscriptions.length} push subscription(s).` : "No OneSignal user has this account's id. The app never called login on a phone with push." });
  // Never prune tokens while APNs itself is misconfigured: those failures aren't the tokens' fault.
  const apnsHealthy = !app.readable || app.bundleMatches !== false;
  const removed = apnsHealthy ? await removeStale(env, user, subId || null) : [];
  if (removed.length) {
    await doRequest(env, "Directory", "global", "/push-device-remove", { method: "POST", body: JSON.stringify({ subIds: removed }) });
    steps.push({ step: "Stale tokens removed", ok: true, detail: `${removed.length} invalid/unsubscribed subscription(s) deleted from OneSignal.` });
    user = { ...user, subscriptions: user.subscriptions.filter((s) => !removed.includes(s.id)) };
  }
  const mine = subId ? user.subscriptions.find((s) => s.id === subId) ?? null : null;
  const registered = subId ? (await storedDevices(env, userId)).some((d) => d.subscriptionId === subId) : false;
  if (subId) {
    steps.push({
      step: "This iPhone's subscription", ok: !!mine?.subscribed,
      detail: mine ? `${mine.id.slice(0, 8)}… · ${mine.stateText} · token ${mine.hasToken ? mine.tokenTail : "missing"} · ${mine.environment} · SDK ${mine.sdk || "?"} · app ${mine.appVersion || "?"}`
        : registered ? "The phone registered with us, but OneSignal hasn't linked it to your account yet." : "This phone's subscription isn't known to OneSignal for your account.",
    });
  }
  // Target this exact phone when we can prove it's the caller's; otherwise every phone on the account.
  const target: Record<string, unknown> = subId && (mine || registered) ? { include_subscription_ids: [subId] } : { include_aliases: { external_id: [userId] } };
  const sent = await sendPush(env, {
    ...target,
    headings: { en: "Test notification" }, contents: { en: `Hi ${name.split(" ")[0] || "Coach"}, push from the production backend works on this phone.` },
    data: { kind: "test", category: "league", link: "none" }, ios_sound: "default",
  });
  if (!sent.notificationId) {
    steps.push({ step: "Send through OneSignal", ok: false, detail: sent.error ?? "Not sent." });
    const why = userProblem(user);
    if (why) steps.push({ step: "Why no device", ok: false, detail: why });
    return done(sent.httpStatus >= 400 ? "failed" : "no-device", { user, error: sent.error, reason: why, raw: sent.raw });
  }
  steps.push({ step: "Send through OneSignal", ok: true, detail: `Notification ${sent.notificationId} created${sent.invalid ? ` (skipped: ${sent.invalid})` : ""}.` });
  const stats = await waitForStats(env, sent.notificationId, 4, 2500);
  const verdict = statsVerdict(stats);
  steps.push({ step: "APNs outcome", ok: verdict.status === "delivered", detail: verdict.text });
  if (verdict.status === "failed" && apnsHealthy && (stats?.failed ?? 0) > 0) {
    const after = await viewUser(env, userId);
    const gone = await removeStale(env, after, null);
    if (gone.length) {
      await doRequest(env, "Directory", "global", "/push-device-remove", { method: "POST", body: JSON.stringify({ subIds: gone }) });
      steps.push({ step: "Invalid tokens removed", ok: true, detail: `${gone.length} subscription(s) APNs rejected were deleted. Reopen the app to register a fresh token.` });
    }
  }
  if (verdict.status === "failed" && !apnsHealthy) {
    steps.push({ step: "Root cause", ok: false, detail: `OneSignal sends with APNs topic "${String(app.bundleId)}" but this app is "${BUNDLE_ID}". Fix the Bundle ID in OneSignal → Settings → Push & In-App → Apple iOS.` });
  }
  return done(verdict.status, { notificationId: sent.notificationId, stats, user, app });
}

/** Delivers a password reset code by email (when an email service key is configured) and by push to signed-in devices. */
async function deliverResetCode(env: Env, email: string, userId: string, name: string, code: string): Promise<boolean> {
  let sent = false;
  if (env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Fantasy T&F <onboarding@resend.dev>",
        to: [email],
        subject: "Your Fantasy T&F reset code",
        text: `Hi ${name},\n\nYour password reset code is ${code}. It expires in 20 minutes.\n\nIf you didn't ask for this, ignore this email.`,
      }),
    }).catch(() => null);
    if (r?.ok) sent = true;
    else console.warn("reset email failed", r?.status ?? "network");
  }
  if (env.ONESIGNAL_APP_ID && env.ONESIGNAL_REST_API_KEY) {
    const r = await fetch("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}` },
      body: JSON.stringify({
        app_id: env.ONESIGNAL_APP_ID, target_channel: "push", include_aliases: { external_id: [userId] },
        headings: { en: "Password reset code" }, contents: { en: `Your Fantasy T&F reset code is ${code}. It expires in 20 minutes.` },
        data: { kind: "account" },
      }),
    }).catch(() => null);
    if (r?.ok) sent = true;
  }
  return sent;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/ping") return json({ ok: true, build: "b33-schools", now: new Date().toISOString() });
      // Public, read-only: which league is the Main League and the global config version (no secrets).
      if (path === "/global/status" && request.method === "GET") return relay(await doRequest(env, "Directory", "global", "/global-status"));
      // Public, read-only: the 5-tier table merge report (every kept / replaced / dropped tier) and shared-history stats.
      if (path === "/global/tables-report" && request.method === "GET") return relay(await doRequest(env, "Directory", "global", "/global-tables-report"));
      if (path === "/config") return json({ oneSignalAppId: env.ONESIGNAL_APP_ID ?? "", emailReset: !!env.RESEND_API_KEY });

      // MARK: Accounts (public)

      if (path === "/auth/signup" && request.method === "POST") {
        const body = await request.text();
        return withSession(env, await doRequest(env, "Directory", "global", "/signup", { method: "POST", body }));
      }
      if (path === "/auth/login" && request.method === "POST") {
        const body = await request.text();
        return withSession(env, await doRequest(env, "Directory", "global", "/login", { method: "POST", body }));
      }
      if (path === "/auth/reset-request" && request.method === "POST") {
        const body = (await request.json()) as { email?: string };
        const email = (body.email ?? "").trim().toLowerCase();
        const res = await doRequest(env, "Directory", "global", "/reset-request", { method: "POST", body: JSON.stringify({ email }) });
        const r = (await res.json()) as { code: string | null; name?: string; id?: string };
        if (r.code && r.id) ctx.waitUntil(deliverResetCode(env, email, r.id, r.name ?? "Coach", r.code).then(() => undefined));
        return json({ ok: true, email: !!env.RESEND_API_KEY });
      }
      if (path === "/auth/reset-confirm" && request.method === "POST") {
        const body = await request.text();
        return withSession(env, await doRequest(env, "Directory", "global", "/reset-confirm", { method: "POST", body }));
      }

      const avatar = path.match(/^\/leagues\/([A-Za-z0-9]{8,40})\/avatar\/([A-Za-z0-9_-]{8,64})$/);
      if (avatar && request.method === "GET") {
        const res = await doRequest(env, "League", avatar[1] as string, `/avatar?teamId=${encodeURIComponent(avatar[2] as string)}`);
        return new Response(res.body, { status: res.status, headers: { ...CORS, "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": res.headers.get("Cache-Control") ?? "no-store" } });
      }

      const aphoto = path.match(/^\/leagues\/([A-Za-z0-9]{8,40})\/athlete-photo\/([A-Za-z0-9_-]{1,64})$/);
      if (aphoto && request.method === "GET") {
        const v = url.searchParams.get("v") ?? "";
        const res = await doRequest(env, "League", aphoto[1] as string, `/athlete-photo?athleteId=${encodeURIComponent(aphoto[2] as string)}&v=${encodeURIComponent(v)}`);
        return new Response(res.body, { status: res.status, headers: { ...CORS, "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": res.headers.get("Cache-Control") ?? "no-store" } });
      }

      const live = path.match(/^\/leagues\/([A-Za-z0-9]{8,40})\/live$/);
      if (live && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const u = await userFromToken(env, url.searchParams.get("token") ?? "");
        if (!u) return json({ error: "Sign in again." }, 401);
        const target = new URL(request.url);
        target.searchParams.delete("token");
        target.searchParams.set("userId", u.id);
        const wrapped = new Request(target.toString(), request);
        wrapped.headers.set("X-Rork-DO-Class", "League");
        wrapped.headers.set("X-Rork-DO-Id", live[1] as string);
        return env.DO.fetch(wrapped);
      }

      // MARK: Everything below requires a valid session

      const session = await authed(request, env);
      if (!session) return json({ error: "Your session expired. Sign in again." }, 401);
      const user: User = { id: session.id, name: session.name };

      if (path === "/me" && request.method === "GET") {
        return withSession(env, await doRequest(env, "Directory", "global", `/account?id=${encodeURIComponent(user.id)}`));
      }
      if (path === "/me" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        return withSession(env, await doRequest(env, "Directory", "global", "/account", { method: "POST", body: JSON.stringify({ ...body, id: user.id }) }));
      }
      if (path === "/me/password" && request.method === "POST") {
        const body = (await request.json()) as { current?: string; password?: string };
        const res = await doRequest(env, "Directory", "global", "/change-password", { method: "POST", body: JSON.stringify({ id: user.id, current: body.current ?? "", password: body.password ?? "" }) });
        sessionChecks.clear();
        // The caller gets a fresh session; every other session signed in before now stops working.
        if (res.ok) await new Promise((r) => setTimeout(r, 1100));
        return withSession(env, res);
      }
      if (path === "/master/status" && request.method === "GET") {
        return relay(await doRequest(env, "Directory", "global", `/pool-status?userId=${encodeURIComponent(user.id)}`));
      }
      if (path === "/me/push/register" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        return relay(await doRequest(env, "Directory", "global", "/push-device", { method: "POST", body: JSON.stringify({ ...body, userId: user.id }) }));
      }
      if (path === "/me/push/unregister" && request.method === "POST") {
        const body = (await request.json()) as { subscriptionId?: string };
        const sub = String(body.subscriptionId ?? "");
        const owned = sub ? (await storedDevices(env, user.id)).some((d) => d.subscriptionId === sub) : false;
        if (owned) await doRequest(env, "Directory", "global", "/push-device-remove", { method: "POST", body: JSON.stringify({ subIds: [sub] }) });
        return json({ ok: true, removed: owned });
      }
      if (path === "/me/push/status" && request.method === "GET") {
        return json(await pushStatus(env, user.id, url.searchParams.get("subscriptionId") ?? ""));
      }
      // Idempotent repair: points OneSignal's APNs topic at this app's real bundle id. Takes no input, so it can only set the correct value.
      if (path === "/push/fix-bundle" && request.method === "POST") {
        const before = await appConfig(env);
        if (before.readable && before.bundleMatches === true) return json({ ok: true, changed: false, before });
        const orgKey = env.ONESIGNAL_ORG_API_KEY ?? "";
        if (!orgKey) return json({ ok: false, changed: false, error: "Needs ONESIGNAL_ORG_API_KEY (OneSignal Organization API key), or change the Bundle ID in the OneSignal dashboard.", before });
        const r = await osFetch({ ...env, ONESIGNAL_REST_API_KEY: orgKey }, `/apps/${env.ONESIGNAL_APP_ID}`, { method: "PUT", body: { apns_bundle_id: BUNDLE_ID } });
        const after = await appConfig(env);
        console.log("push fix-bundle", r.status, after.bundleId);
        return json({ ok: r.ok && after.bundleMatches === true, changed: r.ok, status: r.status, error: r.ok ? null : errorText(r.body) || JSON.stringify(r.body).slice(0, 200), before, after });
      }
      // Aggregate, anonymous view of every iOS push subscription OneSignal has for this app (no ids or tokens returned).
      if (path === "/push/overview" && request.method === "GET") {
        const r = await osFetch(env, `/players?app_id=${env.ONESIGNAL_APP_ID}&limit=300`);
        const players = (r.body.players ?? []) as Record<string, unknown>[];
        const rows = players.map((p) => ({
          linked: !!p.external_user_id, mine: p.external_user_id === user.id, state: String(p.notification_types ?? 0), env: Number(p.test_type ?? 0) === 1 ? "sandbox" : "production",
          invalid: p.invalid_identifier === true, hasToken: String(p.identifier ?? "").length > 0, model: String(p.device_model ?? ""), os: String(p.device_os ?? ""),
          app: String(p.game_version ?? ""), sdk: String(p.sdk ?? ""), lastActive: typeof p.last_active === "number" ? new Date((p.last_active as number) * 1000).toISOString() : null,
        }));
        const h = await osFetch(env, `/notifications?app_id=${env.ONESIGNAL_APP_ID}&limit=25`);
        const recent = ((h.body.notifications ?? []) as Record<string, unknown>[]).map((n) => ({
          at: typeof n.queued_at === "number" ? new Date((n.queued_at as number) * 1000).toISOString() : null,
          title: String(((n.headings ?? {}) as Record<string, string>).en ?? "").slice(0, 40),
          successful: n.successful ?? null, failed: n.failed ?? null, errored: n.errored ?? null, received: n.received ?? null, remaining: n.remaining ?? null,
          ios: ((n.platform_delivery_stats ?? {}) as Record<string, unknown>).ios ?? null,
        }));
        return json({ status: r.status, error: r.ok ? null : errorText(r.body), app: await appConfig(env), total: rows.length, messageable: rows.filter((x) => x.hasToken && !x.invalid).length, recent, historyStatus: h.status, devices: rows.sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive))) });
      }
      if (path === "/me/push/test" && request.method === "POST") {
        const body = (await request.json()) as { subscriptionId?: string };
        const result = await pushTest(env, user.id, user.name, String(body.subscriptionId ?? ""));
        console.log("push test", user.id, result.status);
        return json(result);
      }
      if (path === "/me/delete" && request.method === "POST") {
        return relay(await doRequest(env, "Directory", "global", "/delete-account", { method: "POST", body: JSON.stringify({ id: user.id }) }));
      }

      // MARK: Global Fantasy T&F configuration (shared by every league, the app and the website)

      if (path === "/global" && request.method === "GET") {
        return relay(await doRequest(env, "Directory", "global", "/global-config"));
      }
      if (path === "/global/leagues" && request.method === "GET") {
        return relay(await doRequest(env, "Directory", "global", `/global-leagues?userId=${encodeURIComponent(user.id)}`));
      }
      if (path === "/global/action" && request.method === "POST") {
        // The Directory checks with the Main League itself that this user is its commissioner. The client is never trusted.
        const action = (await request.json()) as Record<string, unknown>;
        return relay(await doRequest(env, "Directory", "global", "/global-action", { method: "POST", body: JSON.stringify({ user, action, via: null }) }));
      }

      // School names for the create-league picker.
      if (path === "/schools" && request.method === "GET") return relay(await doRequest(env, "Directory", "global", "/schools"));
      // Stage data checks: counts (and, for "-before" tags, a one-time backup of every league). Names/ids are hidden
      // unless the Main League commissioner asks for detail.
      if (path === "/global/integrity" && request.method === "POST") {
        const body = (await request.json()) as { tag?: string };
        return relay(await doRequest(env, "Directory", "global", "/integrity-sweep", { method: "POST", body: JSON.stringify({ tag: body.tag ?? "" }) }));
      }
      if (path === "/global/integrity" && request.method === "GET") {
        const q = new URLSearchParams({ tag: url.searchParams.get("tag") ?? "", detail: url.searchParams.get("detail") ?? "", userId: user.id });
        return relay(await doRequest(env, "Directory", "global", `/integrity-report?${q.toString()}`));
      }

      if (path === "/leagues" && request.method === "GET") {
        return relay(await doRequest(env, "Directory", "global", `/mine?userId=${encodeURIComponent(user.id)}`));
      }

      if (path === "/leagues" && request.method === "POST") {
        const body = (await request.json()) as { name?: string; teamName?: string; settings?: Record<string, number>; school?: string };
        const leagueId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
        const name = (body.name ?? "").trim().slice(0, 40) || "Track League";
        const reserve = await doRequest(env, "Directory", "global", "/reserve", { method: "POST", body: JSON.stringify({ leagueId, name }) });
        if (!reserve.ok) return relay(reserve);
        const { code } = (await reserve.json()) as { code: string };
        const init = await doRequest(env, "League", leagueId, "/init", {
          method: "POST",
          body: JSON.stringify({ id: leagueId, name, code, user, teamName: body.teamName ?? "", settings: body.settings ?? {}, school: typeof body.school === "string" ? body.school.slice(0, 80) : "" }),
        });
        if (!init.ok) return relay(init);
        await doRequest(env, "Directory", "global", "/member", { method: "POST", body: JSON.stringify({ userId: user.id, leagueId }) });
        return relay(init);
      }

      if (path === "/leagues/join" && request.method === "POST") {
        const body = (await request.json()) as { code?: string; teamName?: string };
        const lookup = await doRequest(env, "Directory", "global", `/lookup?code=${encodeURIComponent(body.code ?? "")}`);
        if (!lookup.ok) return relay(lookup);
        const { leagueId } = (await lookup.json()) as { leagueId: string };
        const joined = await doRequest(env, "League", leagueId, "/join", { method: "POST", body: JSON.stringify({ user, teamName: body.teamName ?? "" }) });
        if (!joined.ok) return relay(joined);
        await doRequest(env, "Directory", "global", "/member", { method: "POST", body: JSON.stringify({ userId: user.id, leagueId }) });
        return relay(joined);
      }

      // MARK: Co-manager invites (the invitee isn't in the league yet)

      const coOp = path.match(/^\/leagues\/co\/(preview|accept|decline)$/);
      if (coOp && request.method === "POST") {
        const body = (await request.json()) as { code?: string };
        const lookup = await doRequest(env, "Directory", "global", `/co-lookup?code=${encodeURIComponent(body.code ?? "")}`);
        if (!lookup.ok) return relay(lookup);
        const { leagueId, teamId, code } = (await lookup.json()) as { leagueId: string; teamId: string; code: string };
        const res = await doRequest(env, "League", leagueId, `/co-${coOp[1]}`, { method: "POST", body: JSON.stringify({ user, teamId, code }) });
        if (!res.ok) return relay(res);
        if (coOp[1] === "accept") {
          await doRequest(env, "Directory", "global", "/member", { method: "POST", body: JSON.stringify({ userId: user.id, leagueId }) });
          await doRequest(env, "Directory", "global", "/co-drop", { method: "POST", body: JSON.stringify({ code }) });
        }
        if (coOp[1] === "decline") await doRequest(env, "Directory", "global", "/co-drop", { method: "POST", body: JSON.stringify({ code }) });
        return relay(res);
      }

      const match = path.match(/^\/leagues\/([A-Za-z0-9]{8,40})(?:\/(action|preview|athlete|scoring|avatar|athlete-photo|meet-test|meet-lab|matchup|dbstatus|projections|mock|delete|hide|breakdown|tools))?$/);
      if (match) {
        const leagueId = match[1] as string;
        const sub = match[2] ?? "";
        const uidQ = `userId=${encodeURIComponent(user.id)}`;
        if (!sub && request.method === "GET") {
          const since = url.searchParams.get("since") ?? "-1";
          return relay(await doRequest(env, "League", leagueId, `/state?${uidQ}&since=${encodeURIComponent(since)}`));
        }
        if (sub === "athlete" && request.method === "GET") {
          const athleteId = url.searchParams.get("athleteId") ?? "";
          return relay(await doRequest(env, "League", leagueId, `/athlete?${uidQ}&athleteId=${encodeURIComponent(athleteId)}`));
        }
        if (sub === "matchup" && request.method === "GET") {
          const week = url.searchParams.get("week") ?? "";
          const teamId = url.searchParams.get("teamId") ?? "";
          return relay(await doRequest(env, "League", leagueId, `/matchup?${uidQ}&week=${encodeURIComponent(week)}&teamId=${encodeURIComponent(teamId)}`));
        }
        if (sub === "dbstatus" && request.method === "GET") return relay(await doRequest(env, "League", leagueId, `/dbstatus?${uidQ}`));
        if (sub === "breakdown" && request.method === "GET") {
          const q = new URLSearchParams({ userId: user.id, week: url.searchParams.get("week") ?? "", athleteId: url.searchParams.get("athleteId") ?? "", teamId: url.searchParams.get("teamId") ?? "" });
          return relay(await doRequest(env, "League", leagueId, `/breakdown?${q.toString()}`));
        }
        if (sub === "tools" && request.method === "POST") {
          const action = (await request.json()) as Record<string, unknown>;
          return relay(await doRequest(env, "League", leagueId, "/tools", { method: "POST", body: JSON.stringify({ user, action }) }));
        }
        if (sub === "projections" && request.method === "GET") {
          const q = new URLSearchParams({
            userId: user.id, week: url.searchParams.get("week") ?? "", athleteId: url.searchParams.get("athleteId") ?? "",
            rankings: url.searchParams.get("rankings") ?? "", explain: url.searchParams.get("explain") ?? "", accuracy: url.searchParams.get("accuracy") ?? "",
          });
          return relay(await doRequest(env, "League", leagueId, `/projections?${q.toString()}`));
        }
        if (sub === "mock" && request.method === "GET") {
          return relay(await doRequest(env, "League", leagueId, `/mock?${uidQ}&mockId=${encodeURIComponent(url.searchParams.get("mockId") ?? "")}`));
        }
        if (sub === "mock" && request.method === "POST") {
          const op = (await request.json()) as Record<string, unknown>;
          return relay(await doRequest(env, "League", leagueId, "/mock", { method: "POST", body: JSON.stringify({ user, op }) }));
        }
        if (sub === "delete" && request.method === "POST") {
          const body = (await request.json()) as { confirmName?: string };
          return relay(await doRequest(env, "League", leagueId, "/delete", { method: "POST", body: JSON.stringify({ user, confirmName: body.confirmName ?? "" }) }));
        }
        if (sub === "hide" && request.method === "POST") {
          const body = (await request.json()) as { hidden?: boolean };
          return relay(await doRequest(env, "Directory", "global", "/hide", { method: "POST", body: JSON.stringify({ userId: user.id, leagueId, hidden: body.hidden === true }) }));
        }
        if (sub === "scoring" && request.method === "GET") return relay(await doRequest(env, "League", leagueId, `/scoring?${uidQ}`));
        if (sub === "athlete-photo" && request.method === "POST") {
          const body = (await request.json()) as Record<string, unknown>;
          return relay(await doRequest(env, "League", leagueId, "/athlete-photo", {
            method: "POST",
            body: JSON.stringify({ user, athleteId: body.athleteId ?? "", image: body.image ?? "", remove: body.remove === true, expectAt: body.expectAt }),
          }));
        }
        if (sub === "avatar" && request.method === "POST") {
          const body = (await request.json()) as { image?: string };
          return relay(await doRequest(env, "League", leagueId, "/avatar", { method: "POST", body: JSON.stringify({ user, image: body.image ?? "" }) }));
        }
        if ((sub === "action" || sub === "preview" || sub === "meet-test" || sub === "meet-lab") && request.method === "POST") {
          const action = (await request.json()) as Record<string, unknown>;
          return relay(await doRequest(env, "League", leagueId, `/${sub}`, { method: "POST", body: JSON.stringify({ user, action }) }));
        }
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error("worker error", err);
      return json({ error: "Something went wrong. Try again." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
