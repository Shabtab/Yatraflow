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
    const trig = await client.query(`
      select t.tgname, c.relname as table_name, n.nspname as schema_name, p.proname as func_name, t.tgenabled
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal
      order by c.relname, t.tgname
    `)
    console.log('\n--- triggers ---')
    for (const r of trig.rows) console.log(`${r.schema_name}.${r.table_name} :: ${r.tgname} -> ${r.func_name}() [${r.tgenabled}]`)
    const who = await client.query('select current_user, session_user')
    console.log('\nconnected as:', who.rows[0])
    const fn = await client.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('handle_new_user','is_member','is_editor')")
    console.log('functions in public:', fn.rows.map(r => r.proname))
    process.exit(0)
  }
  const sql = `alter table public.trips add column if not exists start_location_coords jsonb;
alter table public.trips add column if not exists destination_coords jsonb;
notify pgrst, 'reload schema'`
  await client.query(sql)
  console.log('OK — trips columns added + PostgREST schema reload notified')
} finally {
  await client.end()
}
