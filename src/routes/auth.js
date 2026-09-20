import { verifyTelegramLogin } from "../telegram.js";
import { createSession, destroySession, purgeExpiredSessions, sessionCookieHeader, clearSessionCookieHeader, readSessionIdFromRequest } from "../session.js";
import { json, isHttps, randomToken } from "../http.js";
import { sendTelegramMessage } from "../telegram-notify.js";
import { escapeTelegramHtml, readJsonLimited } from "../security.js";
import { DEFAULT_PROFILE_NAME } from "./profiles.js";

function serializeUser(user) {
  return {
    id: user.id,
    telegramId: String(user.telegram_id),
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    photoUrl: user.photo_url,
    isAdmin: !!user.is_admin,
    overlayToken: user.overlay_token,
  };
}

async function notifyAdminsOfNewUser(env, ctx, newUser) {
  const { results } = await env.DB.prepare(
    "SELECT telegram_id FROM users WHERE is_admin = 1 AND telegram_id != ?"
  )
    .bind(newUser.telegram_id)
    .all();
  if (!results || results.length === 0) return;

  // The message is sent with parse_mode=HTML, so every user-controlled value
  // must be escaped -- otherwise a first name like "<a href=...>" would inject
  // markup (or make Telegram reject the whole message) in the admin's chat.
  const name = escapeTelegramHtml(
    [newUser.first_name, newUser.last_name].filter(Boolean).join(" ") || "(без имени)"
  );
  const handle = newUser.username ? "@" + escapeTelegramHtml(newUser.username) : "username не указан";
  const text = `🆕 Новый пользователь NeuroOverlay\n${name} (${handle})`;

  for (const row of results) {
    ctx.waitUntil(sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, row.telegram_id, text));
  }
}

export async function handleTelegramLogin(request, env, ctx) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return json({ error: "server_missing_bot_token" }, { status: 500 });

  // A real Telegram login payload is well under 1 KB; cap the body hard so
  // this unauthenticated endpoint can't be used to make the Worker chew on
  // huge requests.
  const body = await readJsonLimited(request, 8 * 1024);
  if (!body.ok) return json({ error: body.error }, { status: body.status });
  const payload = body.value;

  const result = await verifyTelegramLogin(payload, botToken);
  if (!result.ok) {
    return json({ error: "telegram_verification_failed", reason: result.reason }, { status: 401 });
  }

  const { id, first_name, last_name, username, photo_url } = result.data;
  const telegramId = String(id);
  const db = env.DB;

  let user = await db.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(telegramId).first();
  const isNewUser = !user;

  if (user) {
    await db
      .prepare(
        `UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, updated_at = datetime('now')
         WHERE telegram_id = ?`
      )
      .bind(username || null, first_name || null, last_name || null, photo_url || null, telegramId)
      .run();
    user = await db.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(telegramId).first();
  } else {
    const overlayToken = randomToken(24);
    await db
      .prepare(
        `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, overlay_token)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(telegramId, username || null, first_name || null, last_name || null, photo_url || null, overlayToken)
      .run();
    user = await db.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(telegramId).first();
    // NOTE: this used to also insert a row into the legacy overlay_settings
    // table. Nothing reads that table any more (settings live in
    // overlay_profiles since migration 0002), so it only produced dead rows.
    // The table itself is left in place on purpose -- dropping it is an
    // irreversible change to production data and is a separate, manual step.
    // Every account needs at least one overlay profile to actually use the
    // site -- give them their first one immediately, reusing the same
    // token so /overlay/<token> from a first-time signup works right away.
    await db
      .prepare("INSERT INTO overlay_profiles (user_id, name, token, state) VALUES (?, ?, ?, '{}')")
      .bind(user.id, DEFAULT_PROFILE_NAME, overlayToken)
      .run();
  }

  if (isNewUser && ctx) {
    // Fire-and-forget -- must never delay or fail the person's own login.
    ctx.waitUntil(notifyAdminsOfNewUser(env, ctx, user));
  }

  const session = await createSession(db, user.id);
  if (ctx && Math.random() < 0.05) {
    ctx.waitUntil(purgeExpiredSessions(db).catch((e) => console.error("[sessions] purge failed", e)));
  }
  return json(
    { user: serializeUser(user) },
    { headers: { "set-cookie": sessionCookieHeader(session.id, session.expiresAt, { secure: isHttps(request) }) } }
  );
}

export async function handleLogout(request, env) {
  const sessionId = readSessionIdFromRequest(request);
  await destroySession(env.DB, sessionId);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookieHeader({ secure: isHttps(request) }) } });
}

export async function handleMe(request, env, ctx, user) {
  if (!user) return json({ error: "not_authenticated" }, { status: 401 });
  return json({ user: serializeUser(user) });
}

export { serializeUser };
