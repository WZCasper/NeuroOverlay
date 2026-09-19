// Small, dependency-free security helpers shared by the Worker routes.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated, state-changing API calls.
 *
 * The session cookie is SameSite=Lax, which already blocks most cross-site
 * POSTs, but Lax is not a complete defence (same-site subdomains, older
 * browsers). Browsers always attach an Origin header to cross-origin
 * fetch/XHR and to every non-GET form post, so for unsafe methods we require
 * that Origin (or, failing that, Referer) belongs to this very host.
 *
 * Requests with neither header are allowed only when they carry no cookie at
 * all -- i.e. they are not riding on a browser session (curl, the smoke test,
 * server-to-server calls). A browser request that has a session cookie but no
 * Origin/Referer is refused.
 *
 * @returns {boolean} true when the request may proceed
 */
export function isSameOriginRequest(request) {
  if (SAFE_METHODS.has(request.method)) return true;

  const host = new URL(request.url).host;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return !request.headers.get("cookie");
}

/** Escapes text for Telegram's parse_mode=HTML (only these 3 characters matter). */
export function escapeTelegramHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escapes the LIKE wildcards so user input is matched literally.
 * Use together with `ESCAPE '\\'` in the SQL.
 */
export function escapeLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, (ch) => "\\" + ch);
}

/**
 * Reads a JSON body but refuses anything bigger than `maxBytes`, so a huge
 * request cannot be used to burn Worker CPU/memory. Checks the declared
 * Content-Length first (cheap), then the real size after reading.
 *
 * @returns {Promise<{ ok: true, value: any } | { ok: false, status: number, error: string }>}
 */
export async function readJsonLimited(request, maxBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "invalid_body" };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}
