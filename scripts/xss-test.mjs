// XSS regression test for the public overlay page (public/overlay.html).
//
// The saved layout ("state") that this page renders is untrusted: it comes
// from the database, from pasted preset codes and from the live sync socket.
// This test loads the REAL page in jsdom and feeds it
//   1. a hostile state  -> nothing may execute, no script-scheme URL may be embedded
//   2. a legitimate state -> text/URLs must still render exactly as typed
//
// Limits (be honest about them): jsdom is not a real browser. It fires the
// event handlers this test dispatches by hand and never actually navigates a
// `javascript:` iframe, so for URLs the test asserts on the resulting
// attribute instead of on execution. Run `npm run xss-test`; no server needed.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, "..", "public", "overlay.html"), "utf8");

let passed = 0;
const ok = (label) => { passed++; console.log(`  \u2713 ${label}`); };

// Guard against shipping a stale copy: overlay.html and dashboard.html are the
// same program and must only differ in their 2-line mode header. If someone
// regenerates one but not the other, the un-hardened one ends up in production.
{
  const dash = readFileSync(path.join(here, "..", "public", "dashboard.html"), "utf8");
  const strip = (h) => h.replace(/window\.NOV_MODE = "[a-z]+";\n(window\.NOV_TOKEN = [^\n]*\n|\n)/, "");
  assert.strictEqual(strip(html), strip(dash), "overlay.html and dashboard.html must be identical apart from the NOV_MODE header");
  for (const fn of ["function escHtml", "function safeId", "function safeUrl", "function safeImgUrl"]) {
    assert.ok(html.includes(fn), `overlay.html is missing ${fn} -- a stale/un-hardened copy?`);
  }
  ok("overlay.html and dashboard.html are in sync and both contain the security helpers");
}

function loadPage(state) {
  const errors = [];
  const sockets = [];
  const vc = new VirtualConsole();
  // jsdom cannot fetch stylesheets/iframes over the network; that is noise, not a page bug.
  vc.on("jsdomError", (e) => { if (!/Could not load (link|iframe)/.test(String(e.message))) errors.push(String(e.message)); });
  const dom = new JSDOM(html, {
    url: "http://localhost:8787/overlay/TESTTOKEN",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes("/state") ? { state } : {}) });
      window.WebSocket = class {
        constructor() { this.readyState = 1; this.h = {}; sockets.push(this); }
        addEventListener(t, f) { (this.h[t] = this.h[t] || []).push(f); }
        removeEventListener() {} send() {} close() {}
      };
    },
  });
  return new Promise((resolve) => setTimeout(() => resolve({
    window: dom.window, errors, close: () => dom.window.close(),
    // Deliver a message exactly as the Durable Object's broadcast would.
    push: (msg) => sockets.forEach((sk) => (sk.h.message || []).forEach((f) => f({ data: JSON.stringify(msg) }))),
  }), 2500));
}

const PWN = (n) => `window.__PWN_${n}=1`;

// ---------- 1. hostile state ----------
{
  const hostile = {
    v: 1,
    main: {
      v: 6, wins: {},
      ws: {
        cw1: { txt: `<img src=x onerror="${PWN("cwtxt")}">`, url: "javascript:window.__PWN_wsurl=1" },
        cw2: { txt: "ok" },
      },
      dynN: 2, tickN: 3, popN: 2,
      tickers: [
        { id: "tick1", text: `<details open ontoggle="${PWN("ticktxt")}"></details>`, img: `x" onerror="${PWN("tickimg")}`, speed: "4" },
        { id: `tick2" onmouseover="${PWN("tickid")}`, text: "id-attack", speed: "4" },
        { id: "tick3", text: "speed-attack", speed: `4;} </style><img src=x onerror=${PWN("tickspd")}>` },
      ],
      popups: [
        { id: "pop1", text: `<details open ontoggle="${PWN("poptxt")}"></details>`, dur: "5" },
        { id: `pop2'] , [x='`, text: "id-attack", dur: `5"><img src=x onerror=${PWN("popdur")}>` },
      ],
      socOn: [`x'] ,[data-w='y`],
      deleted: [`sw_x'] ,[data-w='y`],
      chat: { src: "custom", srcVal: "javascript:window.__PWN_chat=1" },
      viewers: { on: true, url: "javascript:window.__PWN_viewers=1", mode: "widget" },
      daWidget: { on: true, url: "data:text/html,<script>window.__PWN_da=1</script>" },
    },
    presets: {}, daAuth: null, twitchAuth: null,
  };
  const { window: w, errors, close } = await loadPage(hostile);
  const d = w.document;
  // Fire the events that un-escaped attacker markup would rely on.
  d.querySelectorAll("[ontoggle]").forEach((e) => e.dispatchEvent(new w.Event("toggle")));
  d.querySelectorAll("[onerror]").forEach((e) => e.dispatchEvent(new w.Event("error")));
  d.querySelectorAll("[onmouseover]").forEach((e) => e.dispatchEvent(new w.Event("mouseover")));

  const fired = Object.keys(w).filter((k) => k.startsWith("__PWN_"));
  assert.deepStrictEqual(fired, [], `attacker code executed: ${fired.join(", ")}`);
  ok("hostile state: no injected script executes");

  const handlers = d.querySelectorAll("[onerror],[ontoggle],[onmouseover],[onfocus],[onload]").length;
  assert.strictEqual(handlers, 0, "no inline event handler may be injected into the page");
  ok("hostile state: no inline event handlers were injected");

  const badFrames = [...d.querySelectorAll("iframe")].map((f) => f.getAttribute("src") || "").filter((s) => !/^https?:/i.test(s));
  assert.deepStrictEqual(badFrames, [], "only http(s) iframes may be embedded");
  ok("hostile state: javascript:/data: URLs are never embedded as iframes");

  assert.deepStrictEqual(errors, [], "page must not throw on hostile input");
  ok("hostile state: the page loads without uncaught errors");
  close();
}

// ---------- 2. legitimate state must be unchanged ----------
{
  const good = {
    v: 1,
    main: {
      v: 6, wins: {},
      ws: {
        cw1: { txt: 'Мой <канал> & "друзья" 5 > 3', url: "https://example.com/pic.png" },
        cw2: { txt: "Окно 2", url: "https://example.com/widget/index.html?a=1&b=2" },
      },
      dynN: 2, tickN: 1, popN: 1,
      tickers: [{ id: "tick1", text: `Подписывайся & ставь лайк! Tom's "show" <3`, img: "https://example.com/i.png", speed: "6" }],
      popups: [{ id: "pop1", text: "Спасибо за донат! ❤ 5 < 10", dur: "7" }],
      chat: { src: "twitch", srcVal: "mychannel" },
      viewers: { on: true, url: "http://127.0.0.1:8356/widgets/default/bundle1/host/index.html?widget=states&x=1", mode: "widget" },
      daWidget: { on: true, url: "https://widget.donationalerts.com/widgets/alerts/1?token=abc" },
    },
    presets: {}, daAuth: null, twitchAuth: null,
  };
  const { window: w, errors, close } = await loadPage(good);
  const d = w.document;
  const text = (sel) => d.querySelector(sel)?.textContent;

  assert.strictEqual(text("#tick1_mc span"), `Подписывайся & ставь лайк! Tom's "show" <3`);
  ok("legit state: ticker text renders exactly as typed (&, quotes, <)");
  assert.ok(d.querySelector("#tick1_mc img[src='https://example.com/i.png']"), "ticker image must be restored on load");
  ok("legit state: ticker image is restored on load");
  assert.match(d.getElementById("tick1_mc").getAttribute("style"), /marq 12s/);
  ok("legit state: ticker speed is applied");
  assert.strictEqual(text("#pop1_t"), "Спасибо за донат! ❤ 5 < 10");
  ok("legit state: popup text renders exactly as typed");
  assert.strictEqual(text("#cw1 .wtxt"), 'Мой <канал> & "друзья" 5 > 3');
  ok("legit state: custom window text with <, >, &, quotes survives");
  assert.ok(d.querySelector("#cw1_m img[src='https://example.com/pic.png']"));
  assert.ok(d.querySelector("#cw2_m iframe[src='https://example.com/widget/index.html?a=1&b=2']"));
  ok("legit state: https image and iframe URLs are kept, query strings intact");
  assert.strictEqual(
    d.querySelector("#viewersEmbed iframe")?.getAttribute("src"),
    "http://127.0.0.1:8356/widgets/default/bundle1/host/index.html?widget=states&x=1"
  );
  assert.strictEqual(
    d.querySelector("#daWidgetEmbed iframe")?.getAttribute("src"),
    "https://widget.donationalerts.com/widgets/alerts/1?token=abc"
  );
  ok("legit state: viewers (local http) and DonationAlerts (https) widgets are kept");
  assert.deepStrictEqual(errors, []);
  ok("legit state: the page loads without uncaught errors");
  close();
}

// ---------- 3. canvas aspect ratio follows the profile's format, including live changes ----------
{
  const env = (fmt) => ({ v: 1, main: { v: 6, wins: {} }, presets: {}, daAuth: null, twitchAuth: null, ...(fmt ? { canvasFormat: fmt } : {}) });
  const cvsVars = (w) => [w.document.documentElement.style.getPropertyValue("--cvs-w"), w.document.documentElement.style.getPropertyValue("--cvs-h")].join("x");

  let page = await loadPage(env("9:16"));
  assert.strictEqual(cvsVars(page.window), "9x16", "a 9:16 profile must load as 9:16");
  ok("aspect ratio: a 9:16 profile loads as 9:16");
  page.close();

  page = await loadPage(env(null));
  assert.strictEqual(cvsVars(page.window), "16x9", "profiles without a saved format default to 16:9");
  ok("aspect ratio: a profile without a saved format defaults to 16:9");

  // The regression: an overlay that is already open in OBS must follow a format
  // change made in the editor, without the source being refreshed by hand.
  page.push({ type: "state", state: env("9:16") });
  assert.strictEqual(cvsVars(page.window), "9x16", "live change 16:9 -> 9:16 must reach an open overlay");
  ok("aspect ratio: an already-open overlay follows a live 16:9 -> 9:16 change");
  page.push({ type: "state", state: env("16:9") });
  assert.strictEqual(cvsVars(page.window), "16x9", "live change back to 16:9 must also apply");
  ok("aspect ratio: ...and the change back to 16:9");
  page.push({ type: "state", state: env("garbage") });
  assert.strictEqual(cvsVars(page.window), "16x9", "an unknown format value must fall back to 16:9, never break the canvas");
  ok("aspect ratio: an unknown format value falls back to 16:9");
  page.close();
}

console.log(`\nAll ${passed} XSS/regression checks passed.`);
process.exit(0);
