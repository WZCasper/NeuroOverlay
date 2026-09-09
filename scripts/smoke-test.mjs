import assert from "node:assert";
import WebSocket from "ws";
import { signForTest } from "../src/telegram.js";

const BASE = process.env.SMOKE_TEST_BASE_URL || "http://localhost:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const BOT_TOKEN = "1234567890:TEST_TOKEN_FOR_LOCAL_SMOKE_TEST_ONLY"; // matches .dev.vars

let passed = 0;
function ok(label) {
  passed++;
  console.log(`  \u2713 ${label}`);
}

async function fakeTelegramUser(id, overrides = {}) {
  const payload = {
    id,
    first_name: "Test",
    last_name: "User",
    username: `test_user_${id}`,
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  payload.hash = await signForTest(payload, BOT_TOKEN);
  return payload;
}

function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  return raw.split(";")[0];
}

async function login(id) {
  const res = await fetch(`${BASE}/api/auth/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await fakeTelegramUser(id)),
  });
  assert.strictEqual(res.status, 200, `login should succeed (got ${res.status})`);
  const cookie = extractCookie(res);
  assert.ok(cookie, "login response should set a session cookie");
  const body = await res.json();
  return { cookie, user: body.user };
}

async function main() {
  console.log(`Running smoke test against ${BASE}`);

  {
    const res = await fetch(`${BASE}/api/health`);
    assert.strictEqual(res.status, 200);
    ok("health check responds (D1 binding works)");
  }

  {
    const payload = await fakeTelegramUser(900001);
    payload.first_name = "Tampered"; // invalidates the hash
    const res = await fetch(`${BASE}/api/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res.status, 401, "tampered payload must be rejected");
    ok("tampered Telegram signature is rejected");
  }

  {
    const payload = await fakeTelegramUser(900002, {
      auth_date: Math.floor(Date.now() / 1000) - 999999,
    });
    const res = await fetch(`${BASE}/api/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res.status, 401, "expired auth_date must be rejected");
    ok("expired Telegram login is rejected");
  }

  const { cookie, user } = await login(900003);
  assert.ok(user.overlayToken, "a fresh account should get an overlay token immediately");
  ok("valid Telegram login creates a session + user with full access");

  {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.user.overlayToken, user.overlayToken);

    const anon = await fetch(`${BASE}/api/auth/me`);
    assert.strictEqual(anon.status, 401);
    ok("session cookie gates /api/auth/me correctly");
  }

  const sampleState = { widgets: { wNick: { txt: "SMOKE TEST" } }, theme: "#ff0000" };
  {
    const put = await fetch(`${BASE}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ state: sampleState }),
    });
    assert.strictEqual(put.status, 200);

    const get = await fetch(`${BASE}/api/settings`, { headers: { cookie } });
    const body = await get.json();
    assert.deepStrictEqual(body.state, sampleState);
    ok("dashboard can save and re-read its own settings (D1)");
  }

  {
    const res = await fetch(`${BASE}/api/overlay/${user.overlayToken}/state`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.state, sampleState);
    ok("public overlay endpoint serves state without auth");
  }

  {
    const res = await fetch(`${BASE}/api/overlay/not-a-real-token/state`);
    assert.strictEqual(res.status, 404);
    ok("unknown overlay token returns 404");
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws/overlay/${user.overlayToken}`);
    const timeout = setTimeout(() => reject(new Error("WS broadcast not received in time")), 8000);

    ws.on("open", async () => {
      const updated = { ...sampleState, theme: "#00ff00" };
      await fetch(`${BASE}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ state: updated }),
      });
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "state" && msg.state.theme === "#00ff00") {
        clearTimeout(timeout);
        ws.close();
        ok("Durable Object broadcasts the live update to a connected WebSocket");
        resolve();
      }
    });
    ws.on("error", reject);
  });

  {
    const oldToken = user.overlayToken;
    const rotate = await fetch(`${BASE}/api/settings/regenerate-token`, {
      method: "POST",
      headers: { cookie },
    });
    assert.strictEqual(rotate.status, 200);
    const { overlayToken: newToken } = await rotate.json();
    assert.notStrictEqual(newToken, oldToken);

    const oldRes = await fetch(`${BASE}/api/overlay/${oldToken}/state`);
    assert.strictEqual(oldRes.status, 404, "old token must stop working immediately");

    const newRes = await fetch(`${BASE}/api/overlay/${newToken}/state`);
    assert.strictEqual(newRes.status, 200);
    ok("regenerating the overlay token invalidates the old OBS/TikTok link");
  }

  {
    const forbidden = await fetch(`${BASE}/api/admin/users`, { headers: { cookie } });
    assert.strictEqual(forbidden.status, 403);
    ok("non-admin is forbidden from /api/admin/*");
  }

  console.log(`\nAll ${passed} smoke test checks passed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nSMOKE TEST FAILED:", err);
  process.exit(1);
});
