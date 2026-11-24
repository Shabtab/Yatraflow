// ============ #1019 — the invite preview row carries write_version, executed ============
//
// The 20261124c migration is run on a real Postgres (PGlite, in process). The
// row is read as a JSON client would read it, then passed through the same
// admission the client applies. A source scan cannot prove what the RPC
// returns; this file does.
//
// Only the hosted pieces are stubbed: the three roles, `auth.uid()`, and the
// tables and helpers the RPC reads. No network, no live project.
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION = 'supabase/migrations/20261124c_invite_preview_write_version.sql'
const OWNER = '1019a000-0000-4000-8000-000000000001'
const TRIP = '1019a000-0000-4000-8000-000000000002'
const CODE = 'GOA-K7QF'
const WRITE_VERSION = 7

describe('#1019 get_trip_by_invite_code returns write_version on a real database', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.trips (
        id uuid primary key, owner_id uuid not null, name text not null default '',
        start_location text, destinations jsonb, start_date text, end_date text, travellers integer,
        transport_mode text, budget_per_person_inr integer, travel_style text,
        fixed_commitments jsonb not null default '[]', days jsonb not null default '[]',
        expenses jsonb not null default '[]', cover_emoji text, visibility text not null default 'private',
        created_at bigint, updated_at bigint, start_location_coords jsonb, destination_coords jsonb,
        fuel_economy_km_per_l numeric, fuel_price_per_l numeric, round_trip boolean, invite_code text,
        deleted_at timestamptz, driver_count integer, has_vulnerable boolean, drive_after_dinner_min integer,
        vehicle_profile jsonb, cover_image_url text, stay_style text, drives_part boolean,
        write_version bigint not null default 0
      );
      create table public.published_itineraries (
        id text primary key, trip_id uuid, creator_id uuid, premium_price_inr integer
      );
      create table public.entitlements (pub_id text, user_id uuid);
      create function public.is_member(trip uuid) returns boolean language sql stable as $$ select false $$;
      create function public.is_admin() returns boolean language sql stable as $$ select false $$;
      insert into public.trips (id, owner_id, name, invite_code, visibility, created_at, updated_at, write_version)
        values ('${TRIP}', '${OWNER}', 'Goa Beach Week', '${CODE}', 'private', 1, 1, ${WRITE_VERSION});
    `)
    await db.exec(readFileSync(resolve(process.cwd(), MIGRATION), 'utf8'))
  })

  /** The row as PostgREST sends it: one JSON object per trip. */
  async function rpcRowsAsJson(code: string): Promise<unknown[]> {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
    const result = await db.query<{ row: string }>(
      'select row_to_json(r)::text as row from public.get_trip_by_invite_code($1) r',
      [code],
    )
    await db.exec('reset role;')
    return result.rows.map(r => JSON.parse(r.row))
  }

  it('the preview row carries write_version as a JSON number', async () => {
    const rows = await rpcRowsAsJson(CODE)
    expect(rows).toHaveLength(1)
    const row = rows[0] as { write_version: unknown }
    expect(typeof row.write_version).toBe('number')
    expect(row.write_version).toBe(WRITE_VERSION)
  })

  it('the client admission accepts the real RPC row and returns the trip', async () => {
    const { classifyInviteRows } = await import('../src/lib/inviteLookup')
    const { rowToTrip } = await import('../src/lib/tripRow')
    const rows = await rpcRowsAsJson(CODE)
    const verdict = classifyInviteRows(rows)
    expect(verdict.kind).toBe('found')
    if (verdict.kind !== 'found') return
    expect(rowToTrip(verdict.row, []).name).toBe('Goa Beach Week')
  })

  it('an unknown code returns no rows, which the client reads as a dead link', async () => {
    const rows = await rpcRowsAsJson('NOPE-0000')
    expect(rows).toEqual([])
  })
})
