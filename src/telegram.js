// Fields the Telegram Login Widget may send. `hash` itself is never part
// of the data-check-string. See https://core.telegram.org/widgets/login
const TELEGRAM_FIELDS = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"];

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

function timingSafeEqualHex(aHex, bHex) {
  const a = fromHex(aHex);
  const b = fromHex(bHex);
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verifies a Telegram Login Widget payload against a bot token, following
 * Telegram's documented algorithm exactly:
 *   1. secret_key = SHA256(bot_token)
 *   2. data_check_string = every received field except `hash`, sorted
 *      alphabetically by key, joined as "key=value" with "\n"
 *   3. valid if HMAC_SHA256(data_check_string, secret_key) [hex] === hash
 *
 * Uses the Web Crypto API (crypto.subtle) since Workers doesn't have
 * Node's `crypto` module — every step here is therefore async.
 *
 * @param {Record<string, string|number>} payload
 * @param {string} botToken
 * @param {object} [opts]
 * @param {number} [opts.maxAgeSeconds=86400]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, reason: string }>}
 */
export async function verifyTelegramLogin(payload, botToken, opts = {}) {
  const maxAgeSeconds = opts.maxAgeSeconds ?? 86400;

  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "empty_payload" };
  }
  if (!botToken) {
    return { ok: false, reason: "server_missing_bot_token" };
  }
  const hash = payload.hash;
  if (!hash || typeof hash !== "string") {
    return { ok: false, reason: "missing_hash" };
  }

  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== "hash" && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.digest("SHA-256", encoder.encode(botToken));
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(dataCheckString));
  const computedHash = toHex(signature);

  if (!timingSafeEqualHex(computedHash, String(hash))) {
    return { ok: false, reason: "bad_signature" };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "bad_auth_date" };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (ageSeconds < -60) {
    return { ok: false, reason: "auth_date_in_future" };
  }

  const data = {};
  for (const field of TELEGRAM_FIELDS) {
    if (payload[field] !== undefined) data[field] = payload[field];
  }
  return { ok: true, data };
}

/**
 * Signs a payload the same way Telegram would. Only used by the local
 * smoke test to produce a realistic fixture — never called in production
 * request handling.
 */
export async function signForTest(payload, botToken) {
  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("\n");
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.digest("SHA-256", encoder.encode(botToken));
  const hmacKey = await crypto.subtle.importKey("raw", secretKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(dataCheckString));
  return toHex(signature);
}

export { TELEGRAM_FIELDS };
