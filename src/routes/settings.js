import { json, randomToken } from "../http.js";

const MAX_STATE_BYTES = 2 * 1024 * 1024; // 2 MB, same guard as the Node version

async function broadcast(env, token, message) {
  const id = env.OVERLAY_ROOM.idFromName(token);
  const stub = env.OVERLAY_ROOM.get(id);
  try {
    const res = await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    const body = await res.json().catch(() => ({}));
    return body.sent || 0;
  } catch (e) {
    console.error("[broadcast] failed", e);
    return 0;
  }
}

export async function handleGetSettings(request, env, ctx, user) {
  const row = await env.DB.prepare("SELECT state, updated_at FROM overlay_settings WHERE user_id = ?")
    .bind(user.id)
    .first();
  const state = row?.state ? JSON.parse(row.state) : {};
  const isEmpty = !state || Object.keys(state).length === 0;
  return json({ state, isEmpty, updatedAt: row?.updated_at || null });
}

export async function handlePutSettings(request, env, ctx, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }
  const state = body?.state;
  if (state === undefined || state === null || typeof state !== "object") {
    return json({ error: "invalid_state" }, { status: 400 });
  }
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).length > MAX_STATE_BYTES) {
    return json({ error: "state_too_large" }, { status: 413 });
  }

  await env.DB.prepare(
    `INSERT INTO overlay_settings (user_id, state, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = datetime('now')`
  )
    .bind(user.id, serialized)
    .run();

  const sent = await broadcast(env, user.overlay_token, { type: "state", state });
  return json({ ok: true, broadcastTo: sent });
}

export async function handleRegenerateToken(request, env, ctx, user) {
  const newToken = randomToken(24);
  await env.DB.prepare("UPDATE users SET overlay_token = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(newToken, user.id)
    .run();
  // Tell anyone still connected on the old link that it's dead, so a
  // stale OBS/TikTok browser source shows a clear message instead of
  // just silently freezing on the last known state.
  await broadcast(env, user.overlay_token, { type: "token_revoked" });
  return json({ ok: true, overlayToken: newToken });
}
