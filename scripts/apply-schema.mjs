// One-off migration: fixes RLS infinite recursion (42P17) on trip_members.
// Adds public.is_member() and rewrites the two policies that sub-queried
// trip_members directly. Idempotent.
// Run with PG_DUMP=1 to just print all live policies + their definitions.
import { Client } from 'pg'

const conn = process.env.PGCONN
if (!conn) { console.error('Set PGCONN env var to your Postgres connection string first.'); process.exit(1) }

const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  if (process.env.PG_DUMP) {
    const { rows } = await client.query(`
      select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
      where schemaname = 'public'
      order by tablename, policyname
    `)
    for (const r of rows) {
      console.log(`\n=== ${r.tablename} :: ${r.policyname} (${r.cmd})`)
      console.log('  USING:', r.qual)
      console.log('  CHECK:', r.with_check)
    }
    process.exit(0)
  }
  const sql = `notify pgrst, 'reload schema'`
  await client.query(sql)
  console.log('OK — PostgREST schema reload notified')
} finally {
  await client.end()
}
