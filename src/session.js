const COOKIE_NAME = "nov_session";
const SESSION_TTL_DAYS = 30;

function randomId(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Expired rows are never read again (getSessionUser filters on expires_at),
// but without cleanup the table only ever grows. Run the purge on a small
// fraction of logins so it costs nothing on the hot path.
export async function purgeExpiredSessions(db) {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

export async function createSession(db, userId) {
  const id = randomId(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expiresAt)
    .run();
  return { id, expiresAt };
}

export async function getSessionUser(db, sessionId) {
  if (!sessionId) return null;
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .bind(sessionId)
    .first();
  return row || null;
}

export async function destroySession(db, sessionId) {
  if (!sessionId) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function readSessionIdFromRequest(request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  return cookies[COOKIE_NAME] || null;
}

export function sessionCookieHeader(sessionId, expiresAt, { secure } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader({ secure } = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export { COOKIE_NAME };
