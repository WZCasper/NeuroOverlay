import { verifyTelegramLogin } from "../telegram.js";
import { createSession, destroySession, sessionCookieHeader, clearSessionCookieHeader, readSessionIdFromRequest } from "../session.js";
import { json, isHttps, randomToken } from "../http.js";

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

export async function handleTelegramLogin(request, env) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return json({ error: "server_missing_bot_token" }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await verifyTelegramLogin(payload, botToken);
  if (!result.ok) {
    return json({ error: "telegram_verification_failed", reason: result.reason }, { status: 401 });
  }

  const { id, first_name, last_name, username, photo_url } = result.data;
  const telegramId = String(id);
  const db = env.DB;

  let user = await db.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(telegramId).first();

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
    await db.prepare("INSERT INTO overlay_settings (user_id, state) VALUES (?, '{}')").bind(user.id).run();
  }

  const session = await createSession(db, user.id);
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
