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
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try { await pool.query(readFileSync(join(dir, f), "utf8")); ok++; }
    catch (e) { console.warn(`migrate ${f}:`, String(e.message || e).slice(0, 120)); }
  }
  console.log(`migrate: applied ${ok} schema files`);
}
