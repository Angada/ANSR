// Postgres pool. Local docker by default; DATABASE_URL in prod/staging.
// All DB work is best-effort — the app still runs JSON-only if PG is unreachable,
// so a missing DB never blocks doc intake or the UI (ESPL persist pattern).
import pg from "pg";

let pool = null;
let tried = false;

export function getPool() {
  if (tried) return pool;
  tried = true;
  const url = process.env.DATABASE_URL;
  const cfg = url
    ? { connectionString: url, ssl: process.env.PGSSL ? { rejectUnauthorized: false } : undefined }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5433),
        database: process.env.PGDATABASE || "qansr",
        user: process.env.PGUSER || "qansr",
        password: process.env.PGPASSWORD || "qansr",
      };
  try {
    pool = new pg.Pool({ ...cfg, max: 5, idleTimeoutMillis: 30000 });
    pool.on("error", () => {}); // don't crash on idle client errors
  } catch {
    pool = null;
  }
  return pool;
}

export async function q(text, params) {
  const p = getPool();
  if (!p) return { rows: [] };
  return p.query(text, params);
}
