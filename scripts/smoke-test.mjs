import assert from "node:assert";
import WebSocket from "ws";
import { signForTest } from "../src/telegram.js";

const BASE = process.env.SMOKE_TEST_BASE_URL || "http://localhost:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const BOT_TOKEN = "1234567890:TEST_TOKEN_FOR_LOCAL_SMOKE_TEST_ONLY";

// A real browser always attaches an Origin header to state-changing requests
// (and the Worker rejects cookie-authenticated ones without it -- that is the
// CSRF defence). Node's fetch sends none, so add it the way a browser would.
// Individual checks below can still override it to simulate an attacker.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => {
  const headers = { origin: BASE, ...(init.headers || {}) };
  return realFetch(url, { ...init, headers });
};

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
  return raw ? raw.split(";")[0] : null;
}

async function login(id) {
  const res = await fetch(`${BASE}/api/auth/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await fakeTelegramUser(id)),
  });
  assert.strictEqual(res.status, 200, `login should succeed (got ${res.status})`);
  const cookie = extractCookie(res);
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

  const { cookie, user } = await login(980001);
  ok("valid Telegram login creates a session + user");

  // A brand-new account should get exactly one profile automatically.
  let profiles;
  {
    const res = await fetch(`${BASE}/api/profiles`, { headers: { cookie } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    profiles = body.profiles;
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0].name, "Основной");
    ok("new account gets exactly one default profile (Основной)");
  }
  const profile1 = profiles[0];

  // Save + read settings scoped to that profile.
  const stateA = { v: 1, main: { v: 6, wins: {}, tickers: [{ id: "t1", text: "PROFILE A" }] }, presets: {}, daAuth: null, twitchAuth: null };
  {
    const put = await fetch(`${BASE}/api/profiles/${profile1.id}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ state: stateA }),
    });
    assert.strictEqual(put.status, 200);
    const get = await fetch(`${BASE}/api/profiles/${profile1.id}/settings`, { headers: { cookie } });
    const body = await get.json();
    assert.deepStrictEqual(body.state, stateA);
    ok("profile settings save/read correctly, scoped to that profile");
  }

  // Public overlay endpoint resolves through the profile's token.
  {
    const res = await fetch(`${BASE}/api/overlay/${profile1.token}/state`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.state, stateA);
    ok("public overlay endpoint serves state via the profile's token");
  }

  // The actual overlay HTML page (what OBS's browser source loads) is
  // derived server-side from dashboard.html by src/render.js -- confirm the
  // real HTTP route flips NOV_MODE correctly and isn't just serving the
  // dashboard verbatim.
  {
    const res = await fetch(`${BASE}/overlay/${profile1.token}`);
    assert.strictEqual(res.status, 200);
    assert.ok((res.headers.get("content-type") || "").includes("text/html"));
    const html = await res.text();
    assert.ok(html.includes('window.NOV_MODE = "public";'), "overlay page did not render in public mode");
    assert.ok(html.includes("window.NOV_TOKEN = location.pathname"), "overlay page is missing the client-side token line");
    assert.ok(!html.includes('window.NOV_MODE = "dashboard";'), "overlay page leaked dashboard mode");
    assert.ok(html.includes("<title>"), "overlay page looks truncated/broken");
    ok("GET /overlay/:token renders dashboard.html in public mode over real HTTP");
  }

  // Create a second, independent profile.
  let profile2;
  {
    const res = await fetch(`${BASE}/api/profiles`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "9x16" }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    profile2 = body.profile;
    assert.strictEqual(profile2.name, "9x16");
    assert.notStrictEqual(profile2.token, profile1.token);
    ok("creating a second profile gives it a distinct name and token");
  }

  // Its settings must start empty and be fully independent of profile 1.
  {
    const get = await fetch(`${BASE}/api/profiles/${profile2.id}/settings`, { headers: { cookie } });
    const body = await get.json();
    assert.strictEqual(body.isEmpty, true);
    ok("second profile starts with empty state, independent of the first");
  }
  const stateB = { v: 1, main: { v: 6, wins: {}, tickers: [{ id: "t1", text: "PROFILE B" }] }, presets: {}, daAuth: null, twitchAuth: null };
  {
    await fetch(`${BASE}/api/profiles/${profile2.id}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ state: stateB }),
    });
    const get1 = await fetch(`${BASE}/api/profiles/${profile1.id}/settings`, { headers: { cookie } });
    const body1 = await get1.json();
    assert.deepStrictEqual(body1.state, stateA, "saving profile 2 must not touch profile 1's state");
    ok("saving one profile never affects another profile's state");
  }

  // Rename.
  {
    const res = await fetch(`${BASE}/api/profiles/${profile2.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Вертикальный" }),
    });
    assert.strictEqual(res.status, 200);
    const list = await (await fetch(`${BASE}/api/profiles`, { headers: { cookie } })).json();
    assert.ok(list.profiles.some((p) => p.id === profile2.id && p.name === "Вертикальный"));
    ok("renaming a profile works");
  }

  // Each profile's WebSocket room is independent -- a save to profile 2
  // must not broadcast into profile 1's room.
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("expected profile-2 broadcast not received")), 8000);
    const ws1 = new WebSocket(`${WS_BASE}/ws/overlay/${profile1.token}`);
    const ws2 = new WebSocket(`${WS_BASE}/ws/overlay/${profile2.token}`);
    let ws1GotSomething = false;
    let resolved = false;

    ws1.on("message", () => { ws1GotSomething = true; });
    ws2.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "state" && msg.state.main.tickers[0].text === "PROFILE B UPDATED" && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        setTimeout(() => {
          assert.strictEqual(ws1GotSomething, false, "profile 1's room must not receive profile 2's broadcast");
          ws1.close();
          ws2.close();
          ok("each profile's live-sync room is fully isolated from the others");
          resolve();
        }, 500);
      }
    });

    Promise.all([
      new Promise((r) => ws1.on("open", r)),
      new Promise((r) => ws2.on("open", r)),
    ]).then(async () => {
      const updated = { ...stateB, main: { ...stateB.main, tickers: [{ id: "t1", text: "PROFILE B UPDATED" }] } };
      await fetch(`${BASE}/api/profiles/${profile2.id}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ state: updated }),
      });
    });
  });

  // Live status reflects an actually-connected room.
  {
    const ws = new WebSocket(`${WS_BASE}/ws/overlay/${profile1.token}`);
    await new Promise((r) => ws.on("open", r));
    await new Promise((r) => setTimeout(r, 300));
    const status = await (await fetch(`${BASE}/api/profiles/${profile1.id}/live-status`, { headers: { cookie } })).json();
    assert.strictEqual(status.connected, 1);
    ws.close();
    ok("live-status endpoint reports a connected OBS/TikTok source");
  }

  // Deleting the last remaining profile must be refused.
  {
    await fetch(`${BASE}/api/profiles/${profile2.id}`, { method: "DELETE", headers: { cookie } });
    const res = await fetch(`${BASE}/api/profiles/${profile1.id}`, { method: "DELETE", headers: { cookie } });
    assert.strictEqual(res.status, 400);
    ok("deleting the very last profile is refused, deleting a non-last one works");
  }

  // Can't touch another user's profile.
  {
    const other = await login(980002);
    const res = await fetch(`${BASE}/api/profiles/${profile1.id}/settings`, { headers: { cookie: other.cookie } });
    assert.strictEqual(res.status, 404);
    ok("a user cannot read another user's profile settings");
  }

  // ---- CSRF: cookie-authenticated writes from a foreign origin are refused ----
  {
    const csrfUser = await login(980003);
    const list = await (await fetch(`${BASE}/api/profiles`, { headers: { cookie: csrfUser.cookie } })).json();
    const pid = list.profiles[0].id;
    const attempt = (headers) =>
      fetch(`${BASE}/api/profiles/${pid}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: csrfUser.cookie, ...headers },
        body: JSON.stringify({ state: { v: 1, hacked: true } }),
      });

    // Start from a known-clean state. The permitted same-origin write at the end
    // of this block leaves { hacked: true } behind, so without this reset the
    // "nothing changed" assertion below fails on any second run against the
    // same database (the test user is fixed).
    const reset = await fetch(`${BASE}/api/profiles/${pid}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: csrfUser.cookie },
      body: JSON.stringify({ state: { v: 1 } }),
    });
    assert.strictEqual(reset.status, 200, "same-origin reset must succeed");

    assert.strictEqual((await attempt({ origin: "https://evil.example" })).status, 403);
    assert.strictEqual((await attempt({ origin: "null" })).status, 403);
    assert.strictEqual((await attempt({ origin: "", referer: "https://evil.example/page" })).status, 403);
    const stillClean = await (await fetch(`${BASE}/api/profiles/${pid}/settings`, { headers: { cookie: csrfUser.cookie } })).json();
    assert.notStrictEqual(stillClean.state.hacked, true, "a blocked cross-origin write must not change any data");
    assert.strictEqual((await attempt({})).status, 200);
    ok("cross-origin writes with a session cookie are rejected (CSRF), same-origin still works");
  }

  // ---- Oversized login bodies are refused before any crypto/DB work ----
  {
    const big = "x".repeat(20 * 1024);
    const res = await fetch(`${BASE}/api/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, first_name: big }),
    });
    assert.strictEqual(res.status, 413);
    ok("oversized login body is rejected with 413");
  }

  // ---- Admin endpoint is closed to non-admins (LIKE escaping itself is unit-tested separately) ----
  {
    const res = await fetch(`${BASE}/api/admin/users?q=%25`, { headers: { cookie } });
    assert.strictEqual(res.status, 403, "non-admin must not reach the user list");
    ok("admin user list is closed to non-admin accounts");
  }

  console.log(`\nAll ${passed} smoke test checks passed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nSMOKE TEST FAILED:", err);
  process.exit(1);
});
