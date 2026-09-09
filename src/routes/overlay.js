import { json } from "../http.js";

// Deliberately unauthenticated: OBS Browser Source / TikTok LIVE Studio's
// "Link" source can't log in interactively. Security relies on the
// overlay_token itself being an unguessable secret (24 random bytes) --
// treat the URL like a password. The site is free, so there's no
// subscription check here -- any valid token just works.
export async function handleGetOverlayState(request, env, ctx, params) {
  const token = params.token;
  const row = await env.DB.prepare(
    `SELECT s.state FROM users u
     LEFT JOIN overlay_settings s ON s.user_id = u.id
     WHERE u.overlay_token = ?`
  )
    .bind(token)
    .first();
  if (!row) return json({ error: "unknown_token" }, { status: 404 });
  const state = row.state ? JSON.parse(row.state) : {};
  return json({ state });
}
