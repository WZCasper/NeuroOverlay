// Promotes an existing user (they must have logged in at least once via
// Telegram already) to admin, so they can open /admin and see the user list.
//
// This can't run as a plain Node script against D1 the way the old
// Postgres version did -- D1 only accepts SQL through `wrangler d1
// execute`. This file just prints the exact command to run; there is
// nothing to execute here directly.
//
// Usage:
//   node scripts/make-admin.mjs your_telegram_username
//   node scripts/make-admin.mjs 123456789        (numeric Telegram id)
const identifier = process.argv[2];
if (!identifier) {
  console.error("Usage: node scripts/make-admin.mjs <telegram_username_or_id>");
  process.exit(1);
}
const isNumeric = /^\d+$/.test(identifier);
const where = isNumeric ? `telegram_id = ${identifier}` : `username = '${identifier.replace(/'/g, "''")}'`;
const sql = `UPDATE users SET is_admin = 1 WHERE ${where};`;

console.log("Run this once they've logged in to the site at least one time:\n");
console.log(`  npx wrangler d1 execute neuroverlay --remote --command "${sql}"\n`);
console.log("(drop --remote, i.e. just --local, to do this against your local dev database instead)");
