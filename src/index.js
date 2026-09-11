import { readSessionIdFromRequest, getSessionUser } from "./session.js";
import { json } from "./http.js";
import { handleTelegramLogin, handleLogout, handleMe } from "./routes/auth.js";
import { handleGetSettings, handlePutSettings, handleRegenerateToken } from "./routes/settings.js";
import { handleGetOverlayState } from "./routes/overlay.js";
import { handleListUsers } from "./routes/admin.js";
import { handleObsLatest } from "./routes/obs.js";

export { OverlayRoom } from "./room.js";

async function getCurrentUser(request, env) {
  const sessionId = readSessionIdFromRequest(request);
  if (!sessionId) return null;
  return getSessionUser(env.DB, sessionId);
}

function requireAuth(user) {
  if (!user) return json({ error: "not_authenticated" }, { status: 401 });
  return null;
}

async function handleWebSocketUpgrade(request, env, token) {
  const id = env.OVERLAY_ROOM.idFromName(token);
  const stub = env.OVERLAY_ROOM.get(id);
  return stub.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ---- WebSocket (Durable Object) ----
      let m = path.match(/^\/ws\/overlay\/([A-Za-z0-9_-]+)$/);
      if (m) {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("expected websocket upgrade", { status: 400 });
        }
        return handleWebSocketUpgrade(request, env, m[1]);
      }

      // ---- Public overlay page (any token -> same static file) ----
      m = path.match(/^\/overlay\/([A-Za-z0-9_-]+)\/?$/);
      if (m && method === "GET") {
        const asset = await env.ASSETS.fetch(new URL("/overlay.html", url));
        return new Response(asset.body, asset);
      }

      // ---- API: health / config (no auth) ----
      if (path === "/api/health" && method === "GET") {
        try {
          await env.DB.prepare("SELECT 1").first();
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: String(e) }, { status: 500 });
        }
      }
      if (path === "/api/config" && method === "GET") {
        return json({ telegramBotUsername: env.TELEGRAM_BOT_USERNAME || null });
      }
      if (path === "/api/obs-latest" && method === "GET") {
        return handleObsLatest(request, env, ctx);
      }

      // ---- API: auth ----
      if (path === "/api/auth/telegram" && method === "POST") {
        return handleTelegramLogin(request, env);
      }
      if (path === "/api/auth/logout" && method === "POST") {
        return handleLogout(request, env);
      }
      if (path === "/api/auth/me" && method === "GET") {
        const user = await getCurrentUser(request, env);
        return handleMe(request, env, ctx, user);
      }

      // ---- API: public overlay state ----
      m = path.match(/^\/api\/overlay\/([A-Za-z0-9_-]+)\/state$/);
      if (m && method === "GET") {
        return handleGetOverlayState(request, env, ctx, { token: m[1] });
      }

      // ---- API: settings (auth required) ----
      if (path === "/api/settings" && method === "GET") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleGetSettings(request, env, ctx, user);
      }
      if (path === "/api/settings" && method === "PUT") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handlePutSettings(request, env, ctx, user);
      }
      if (path === "/api/settings/regenerate-token" && method === "POST") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleRegenerateToken(request, env, ctx, user);
      }

      // ---- API: admin (auth + is_admin required, checked inside) ----
      if (path === "/api/admin/users" && method === "GET") {
        const user = await getCurrentUser(request, env);
        return handleListUsers(request, env, ctx, user);
      }

      // ---- Everything else: static assets (shouldn't normally be hit
      // because of run_worker_first in wrangler.jsonc, but kept as a
      // safe fallback) ----
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("[worker error]", err);
      return json({ error: "internal_error" }, { status: 500 });
    }
  },
};
