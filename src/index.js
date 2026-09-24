import { readSessionIdFromRequest, getSessionUser } from "./session.js";
import { json } from "./http.js";
import { isSameOriginRequest } from "./security.js";
import { handleTelegramLogin, handleLogout, handleMe } from "./routes/auth.js";
import {
  handleListProfiles,
  handleCreateProfile,
  handleRenameProfile,
  handleDeleteProfile,
  handleGetProfileSettings,
  handlePutProfileSettings,
  handleRegenerateProfileToken,
  handleProfileLiveStatus,
} from "./routes/profiles.js";
import { handleGetOverlayState } from "./routes/overlay.js";
import { handleListUsers } from "./routes/admin.js";
import { handleObsLatest } from "./routes/obs.js";
import { toPublicOverlayHtml } from "./render.js";

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
      // ---- CSRF: state-changing API calls must come from our own origin ----
      if (path.startsWith("/api/") && !isSameOriginRequest(request)) {
        return json({ error: "bad_origin" }, { status: 403 });
      }

      // ---- WebSocket (Durable Object) ----
      let m = path.match(/^\/ws\/overlay\/([A-Za-z0-9_-]+)$/);
      if (m) {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("expected websocket upgrade", { status: 400 });
        }
        return handleWebSocketUpgrade(request, env, m[1]);
      }

      // ---- Public overlay page (any token -> dashboard.html, re-rendered) ----
      // There is only one HTML source file (public/dashboard.html); this
      // route serves it with NOV_MODE flipped to "public" via render.js,
      // so the dashboard and the overlay page can never drift apart the
      // way two hand-maintained copies could.
      m = path.match(/^\/overlay\/([A-Za-z0-9_-]+)\/?$/);
      if (m && method === "GET") {
        const asset = await env.ASSETS.fetch(new URL("/dashboard.html", url));
        const html = toPublicOverlayHtml(await asset.text());
        // Copy the asset's headers (this is where the CSP/security headers
        // from public/_headers come from) but drop content-length/etag:
        // both described the original dashboard.html bytes, not the
        // re-rendered body we're actually sending.
        const headers = new Headers(asset.headers);
        headers.delete("content-length");
        headers.delete("etag");
        return new Response(html, { status: asset.status, headers });
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
        return handleTelegramLogin(request, env, ctx);
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

      // ---- API: profiles (auth required for all of these) ----
      if (path === "/api/profiles" && method === "GET") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleListProfiles(request, env, ctx, user);
      }
      if (path === "/api/profiles" && method === "POST") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleCreateProfile(request, env, ctx, user);
      }
      m = path.match(/^\/api\/profiles\/(\d+)$/);
      if (m && method === "PATCH") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleRenameProfile(request, env, ctx, user, { id: m[1] });
      }
      if (m && method === "DELETE") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleDeleteProfile(request, env, ctx, user, { id: m[1] });
      }
      m = path.match(/^\/api\/profiles\/(\d+)\/settings$/);
      if (m && method === "GET") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleGetProfileSettings(request, env, ctx, user, { id: m[1] });
      }
      if (m && method === "PUT") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handlePutProfileSettings(request, env, ctx, user, { id: m[1] });
      }
      m = path.match(/^\/api\/profiles\/(\d+)\/regenerate-token$/);
      if (m && method === "POST") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleRegenerateProfileToken(request, env, ctx, user, { id: m[1] });
      }
      m = path.match(/^\/api\/profiles\/(\d+)\/live-status$/);
      if (m && method === "GET") {
        const user = await getCurrentUser(request, env);
        return requireAuth(user) || handleProfileLiveStatus(request, env, ctx, user, { id: m[1] });
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
