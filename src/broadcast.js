export async function broadcastToRoom(env, token, message) {
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

export async function roomStatus(env, token) {
  const id = env.OVERLAY_ROOM.idFromName(token);
  const stub = env.OVERLAY_ROOM.get(id);
  try {
    const res = await stub.fetch("https://internal/status");
    const body = await res.json();
    return body.connected || 0;
  } catch (e) {
    console.error("[room-status] failed", e);
    return 0;
  }
}
