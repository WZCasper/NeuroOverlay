// One OverlayRoom instance exists per overlay_token (Durable Object
// instances are addressed by idFromName(token)), and holds every
// currently-connected WebSocket for that token — i.e. every open OBS /
// TikTok LIVE Studio browser source using that link, plus any dashboard
// tab left open. Uses the WebSocket Hibernation API so the object can be
// evicted from memory between messages instead of running (and being
// billed) continuously just to hold idle connections open.
export class OverlayRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const body = await request.json();
      const payload = JSON.stringify(body);
      let sent = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(payload);
          sent++;
        } catch {
          // Socket already gone — hibernation cleans these up on its own,
          // nothing to do here but skip it.
        }
      }
      return new Response(JSON.stringify({ ok: true, sent }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      // Lets the dashboard show "OBS/TikTok connected" without needing to
      // actually save anything -- just asks how many live sockets this
      // room currently holds (works fine even if the object was just
      // woken from hibernation, since the runtime tracks sockets for it).
      return new Response(JSON.stringify({ connected: this.state.getWebSockets().length }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const token = url.pathname.split("/").filter(Boolean).pop();
      const row = await this.env.DB.prepare("SELECT 1 FROM overlay_profiles WHERE token = ?")
        .bind(token)
        .first();
      if (!row) {
        return new Response("unknown token", { status: 404 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Hibernatable accept: the runtime can drop this object from memory
      // between messages and wake it back up on the next event, rather
      // than keeping it (and its bill) running for the whole connection.
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("expected websocket upgrade", { status: 400 });
  }

  // Required by the Hibernation API even when unused — the runtime calls
  // these on the object once it wakes back up for an event.
  async webSocketMessage() {
    // The engine's overlay page is a pure listener; it never sends
    // messages up through this socket, so there's nothing to handle.
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try {
      ws.close(code, reason);
    } catch {
      // already closing
    }
  }

  async webSocketError() {
    // Hibernation API cleans up the socket automatically after an error;
    // nothing additional to do.
  }
}
