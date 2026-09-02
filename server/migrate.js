// Idempotent schema apply on boot. Every db/init/*.sql uses IF NOT EXISTS /
// ON CONFLICT, so running them each start is safe and keeps prod (Supabase) in
// sync without manual psql. Best-effort: a failing file is logged, not fatal.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db/client.js";

export async function runMigrations() {
  const pool = getPool();
  if (!pool) { console.log("migrate: no DB pool — skipped"); return; }
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "init");
  let ok = 0;
  const failed = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try { await pool.query(readFileSync(join(dir, f), "utf8")); ok++; }
    catch (e) { failed.push({ file: f, error: String(e.message || e).slice(0, 200) }); }
  }
  // A failure used to be one console.warn among the boot noise, and the summary
  // line counted only successes — so 046 referenced three columns that did not
  // exist, threw at every single boot, and nobody could tell from the log that an
  // entire backfill had never run. A broken migration is now impossible to miss.
  console.log(`migrate: applied ${ok} schema files${failed.length ? `, ${failed.length} FAILED` : ""}`);
  for (const { file, error } of failed) console.error(`migrate FAILED ${file}: ${error}`);
  MIGRATION_FAILURES.splice(0, MIGRATION_FAILURES.length, ...failed);
  return { ok, failed };
}
// Read by /health so a broken migration is visible in prod without shell access.
export const MIGRATION_FAILURES = [];
