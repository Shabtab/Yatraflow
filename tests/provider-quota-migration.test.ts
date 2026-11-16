// Source scan of the provider quota migration and its supabase/schema.sql mirror.
// The SQL runs only on the operator's database, so these pins keep the properties
// that the client depends on from being edited away. CRLF is read as LF.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const migration = read('supabase/migrations/20261118_provider_quota.sql')
const schema = read('supabase/schema.sql')

/** The function text: from its create statement to the closing dollar quote. */
const functionBlock = (sql: string) =>
  sql.match(/create or replace function public\.consume_provider_quota[\s\S]*?\$\$;/)?.[0] ?? ''

describe('provider quota migration', () => {
  it('is wrapped in one transaction and is additive and re-runnable', () => {
    expect(migration).toMatch(/^begin;$/m)
    expect(migration).toMatch(/^commit;$/m)
    expect(migration).toMatch(/create table if not exists public\.provider_quota_caps\b/)
    expect(migration).toMatch(/create table if not exists public\.provider_quota_usage\b/)
    expect(migration).toMatch(/on conflict \(sku\) do nothing/)
    expect(migration).toMatch(/create or replace function public\.consume_provider_quota\(p_sku text\)/)
    expect(migration).not.toMatch(/\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i)
  })

  it('turns RLS on for both tables and writes no policy', () => {
    expect(migration).toMatch(/alter table public\.provider_quota_caps enable row level security;/)
    expect(migration).toMatch(/alter table public\.provider_quota_usage enable row level security;/)
    expect(migration).not.toMatch(/create policy/)
  })

  it('revokes both tables from public, anon and authenticated by name', () => {
    expect(migration).toMatch(/revoke all on public\.provider_quota_caps from public, anon, authenticated;/)
    expect(migration).toMatch(/revoke all on public\.provider_quota_usage from public, anon, authenticated;/)
  })

  it('makes the function security definer with a pinned search path', () => {
    const block = functionBlock(migration)
    expect(block).toMatch(/\bsecurity definer\b/)
    expect(block).toMatch(/set search_path = public/)
  })

  it('takes the unit in one conditional upsert, so used never passes the cap', () => {
    const block = functionBlock(migration)
    expect(block).toMatch(/on conflict \(sku, month\) do update/)
    expect(block).toMatch(/where u\.used < \(select c2\.monthly_cap/)
    expect(block).toMatch(/c\.monthly_cap > 0/)
  })

  it('grants execute only to anon and authenticated, after revoking from public', () => {
    const revoke = migration.indexOf('revoke all on function public.consume_provider_quota(text) from public, anon, authenticated;')
    const grant = migration.indexOf('grant execute on function public.consume_provider_quota(text) to anon, authenticated;')
    expect(revoke).toBeGreaterThan(-1)
    expect(grant).toBeGreaterThan(revoke)
  })

  it('is mirrored into schema.sql with identical function text, after its tables', () => {
    expect(functionBlock(migration)).not.toBe('')
    expect(functionBlock(schema)).toBe(functionBlock(migration))
    const tables = schema.indexOf('create table if not exists public.provider_quota_usage')
    expect(tables).toBeGreaterThan(-1)
    expect(schema.indexOf('create or replace function public.consume_provider_quota')).toBeGreaterThan(tables)
    expect(schema).toMatch(/revoke all on function public\.consume_provider_quota\(text\) from public, anon, authenticated;/)
    expect(schema).toMatch(/grant execute on function public\.consume_provider_quota\(text\) to anon, authenticated;/)
  })
})
