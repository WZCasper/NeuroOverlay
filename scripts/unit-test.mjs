// Unit tests for the pure helpers in src/security.js. Needs no running Worker
// -- `npm run unit-test` is enough.
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { escapeLike, escapeTelegramHtml, isSameOriginRequest, readJsonLimited } from "../src/security.js";

let passed = 0;
function ok(label) {
  passed++;
  console.log(`  \u2713 ${label}`);
}
const req = (method, headers = {}, url = "https://site.example/api/x") => new Request(url, { method, headers });

// ---- escapeTelegramHtml ----
assert.strictEqual(escapeTelegramHtml('<a href="x">Tom & Jerry</a>'), '&lt;a href="x"&gt;Tom &amp; Jerry&lt;/a&gt;');
assert.strictEqual(escapeTelegramHtml(null), "");
assert.strictEqual(escapeTelegramHtml("&lt;"), "&amp;lt;", "already-escaped input must not be trusted");
ok("escapeTelegramHtml neutralises tags/ampersands and never double-trusts input");

// ---- escapeLike, proven against real SQLite with the exact SQL used in admin.js ----
{
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users(username TEXT, first_name TEXT)");
  const ins = db.prepare("INSERT INTO users VALUES (?, ?)");
  ins.run("alice", "Alice");
  ins.run("bob_1", "Bob");
  ins.run("bobX1", "Bobby");
  ins.run("50%off", "Sale");
  const sql = "SELECT username FROM users WHERE username LIKE ? ESCAPE '\\' OR first_name LIKE ? ESCAPE '\\'";
  const search = (q) => {
    const like = `%${escapeLike(q)}%`;
    return db.prepare(sql).all(like, like).map((r) => r.username).sort();
  };
  assert.deepStrictEqual(search("bob_1"), ["bob_1"], "underscore must match literally, not any single char");
  assert.deepStrictEqual(search("%"), ["50%off"], "a lone % must not match every row");
  assert.deepStrictEqual(search("_"), ["bob_1"]);
  assert.deepStrictEqual(search("alice"), ["alice"]);
  assert.deepStrictEqual(search("a\\b"), [], "a backslash in the query must not break the pattern");
  ok("escapeLike makes % and _ literal in real SQLite (same SQL as admin.js)");
}

// ---- isSameOriginRequest ----
assert.strictEqual(isSameOriginRequest(req("GET")), true);
assert.strictEqual(isSameOriginRequest(req("POST", { origin: "https://site.example" })), true);
assert.strictEqual(isSameOriginRequest(req("POST", { origin: "https://evil.example" })), false);
assert.strictEqual(isSameOriginRequest(req("POST", { origin: "https://site.example.evil.example" })), false, "suffix tricks must fail");
assert.strictEqual(isSameOriginRequest(req("POST", { origin: "null" })), false);
assert.strictEqual(isSameOriginRequest(req("POST", { referer: "https://site.example/dash" })), true);
assert.strictEqual(isSameOriginRequest(req("POST", { referer: "https://evil.example/" })), false);
assert.strictEqual(isSameOriginRequest(req("DELETE", { cookie: "nov_session=abc" })), false, "cookie without Origin/Referer is refused");
assert.strictEqual(isSameOriginRequest(req("POST")), true, "cookieless non-browser client is allowed");
ok("isSameOriginRequest allows same-origin, refuses foreign/null/suffix-spoofed origins");

// ---- readJsonLimited ----
{
  const small = await readJsonLimited(new Request("https://x/", { method: "POST", body: '{"a":1}' }), 100);
  assert.deepStrictEqual(small, { ok: true, value: { a: 1 } });
  const big = await readJsonLimited(new Request("https://x/", { method: "POST", body: JSON.stringify({ a: "x".repeat(500) }) }), 100);
  assert.strictEqual(big.ok, false);
  assert.strictEqual(big.status, 413);
  const bad = await readJsonLimited(new Request("https://x/", { method: "POST", body: "{nope" }), 100);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.status, 400);
  ok("readJsonLimited accepts small JSON, rejects oversized (413) and malformed (400) bodies");
}

console.log(`\nAll ${passed} unit test groups passed.`);
