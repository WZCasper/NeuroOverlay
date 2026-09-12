import { json, randomToken } from "../http.js";
import { broadcastToRoom, roomStatus } from "../broadcast.js";

const MAX_STATE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_PROFILES_PER_USER = 10;
const DEFAULT_PROFILE_NAME = "Основной";

function serializeProfile(row) {
  return { id: row.id, name: row.name, token: row.token, updatedAt: row.updated_at, createdAt: row.created_at };
}

async function getOwnedProfile(env, userId, profileId) {
  return env.DB.prepare("SELECT * FROM overlay_profiles WHERE id = ? AND user_id = ?")
    .bind(profileId, userId)
    .first();
}

export async function handleListProfiles(request, env, ctx, user) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM overlay_profiles WHERE user_id = ? ORDER BY created_at ASC"
  )
    .bind(user.id)
    .all();
  return json({ profiles: results.map(serializeProfile) });
}

export async function handleCreateProfile(request, env, ctx, user) {
  const { results: countRows } = await env.DB.prepare(
    "SELECT count(*) AS n FROM overlay_profiles WHERE user_id = ?"
  )
    .bind(user.id)
    .all();
  if ((countRows[0]?.n || 0) >= MAX_PROFILES_PER_USER) {
    return json({ error: "too_many_profiles", max: MAX_PROFILES_PER_USER }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine, we'll fall back to a default name */
  }
  const name = (typeof body.name === "string" ? body.name.trim() : "").slice(0, 60) || "Новый профиль";
  const token = randomToken(24);

  await env.DB.prepare("INSERT INTO overlay_profiles (user_id, name, token, state) VALUES (?, ?, ?, '{}')")
    .bind(user.id, name, token)
    .run();
  const row = await env.DB.prepare("SELECT * FROM overlay_profiles WHERE token = ?").bind(token).first();
  return json({ profile: serializeProfile(row) });
}

export async function handleRenameProfile(request, env, ctx, user, params) {
  const profile = await getOwnedProfile(env, user.id, params.id);
  if (!profile) return json({ error: "profile_not_found" }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return json({ error: "invalid_name" }, { status: 400 });

  await env.DB.prepare("UPDATE overlay_profiles SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, profile.id)
    .run();
  return json({ ok: true, name });
}

export async function handleDeleteProfile(request, env, ctx, user, params) {
  const profile = await getOwnedProfile(env, user.id, params.id);
  if (!profile) return json({ error: "profile_not_found" }, { status: 404 });

  const { results: countRows } = await env.DB.prepare(
    "SELECT count(*) AS n FROM overlay_profiles WHERE user_id = ?"
  )
    .bind(user.id)
    .all();
  if ((countRows[0]?.n || 0) <= 1) {
    return json({ error: "cannot_delete_last_profile" }, { status: 400 });
  }

  await env.DB.prepare("DELETE FROM overlay_profiles WHERE id = ?").bind(profile.id).run();
  await broadcastToRoom(env, profile.token, { type: "token_revoked" });
  return json({ ok: true });
}

export async function handleGetProfileSettings(request, env, ctx, user, params) {
  const profile = await getOwnedProfile(env, user.id, params.id);
  if (!profile) return json({ error: "profile_not_found" }, { status: 404 });
  const state = profile.state ? JSON.parse(profile.state) : {};
  const isEmpty = !state || Object.keys(state).length === 0;
  return json({ state, isEmpty, updatedAt: profile.updated_at });
}

export async function handlePutProfileSettings(request, env, ctx, user, params) {
  const profile = await getOwnedProfile(env, user.id, params.id);
  if (!profile) return json({ error: "profile_not_found" }, { status: 404 });

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

  await env.DB.prepare("UPDATE overlay_profiles SET state = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(serialized, profile.id)
    .run();

  const sent = await broadcastToRoom(env, profile.token, { type: "state", state });
  return json({ ok: true, broadcastTo: sent });
}

export async function handleRegenerateProfileToken(request, env, ctx, user, params) {
  const profile = await getOwnedProfile(env, user.id, params.id);
  if (!profile) return json({ error: "profile_not_found" }, { status: 404 });

  const newToken = randomToken(24);
  await env.DB.prepare("UPDATE overlay_profiles SET token = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(newToken, profile.id)
    .run();
  await broadcastToRoom(env, profile.token, { type: "token_revoked" });
  return json({ ok: true, token: newToken });
}

export async function handleProfileLiveStatus(request, env, ctx, user, params) {
  const profile = await getOwnedProfile(env, user.id, params.id);
  if (!profile) return json({ error: "profile_not_found" }, { status: 404 });
  const connected = await roomStatus(env, profile.token);
  return json({ connected });
}

export { DEFAULT_PROFILE_NAME };
