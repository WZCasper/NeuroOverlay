// Applies every file in migrations/ to the D1 database, in filename order.
//
//   npm run db:migrate:local    -> node scripts/migrate.mjs --local
//   npm run db:migrate:remote   -> node scripts/migrate.mjs --remote
//
// Before this script existed, the npm scripts pointed at 0001_init.sql only,
// so 0002_profiles.sql (and anything added later) had to be run by hand.
//
// Every migration in this project is written to be safe to run more than once
// (CREATE ... IF NOT EXISTS, INSERT ... WHERE NOT EXISTS), so re-running the
// whole list is harmless.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DB_NAME = "neuroverlay";
const mode = process.argv[2];

if (mode !== "--local" && mode !== "--remote") {
  console.error("Usage: node scripts/migrate.mjs --local | --remote");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = readdirSync(dir)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort();

if (files.length === 0) {
  console.error("No migration files found in migrations/");
  process.exit(1);
}

for (const file of files) {
  console.log(`\n→ applying ${file} (${mode.slice(2)})`);
  const res = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DB_NAME, `--file=migrations/${file}`, mode],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  if (res.status !== 0) {
    console.error(`\n✗ ${file} failed (exit code ${res.status}). Stopping -- later migrations were NOT applied.`);
    process.exit(res.status || 1);
  }
}

console.log(`\n✓ all ${files.length} migration(s) applied`);
