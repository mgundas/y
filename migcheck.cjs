const fs = require("fs");
const postgres = require("postgres");

for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

async function main() {
  const migs = await sql`select id, hash from __drizzle_migrations order by id`;
  console.log("applied migrations:", migs.map((m) => `${m.id}:${String(m.hash).slice(0, 8)}`).join(" "));
  const tables = await sql`select tablename from pg_tables where schemaname = 'public' and tablename in ('blocks')`;
  console.log("blocks table:", tables.length === 1 ? "present" : "MISSING");
  const cons = await sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_dedup_unique'`;
  console.log("dedup constraint:", cons.length === 1 ? cons[0].def : "MISSING");
  const idx = await sql`select indexname from pg_indexes where schemaname = 'public' and indexname in ('posts_parent_created_idx', 'blocks_blocked_id_idx')`;
  console.log("new indexes:", idx.map((i) => i.indexname).join(", ") || "MISSING");
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
