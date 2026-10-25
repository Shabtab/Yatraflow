// ============ admin_delete_user — the SQL contract, pinned in source ============
// The RPC lives in a migration that only a human with Supabase dashboard
// access applies (management plane). Vitest runs in node WITHOUT a database,
// so this suite pins the things that must never silently rot:
//   1. the migration file exists and keeps every guard clause (admin check,
//      self-refusal, last-admin refusal, published-force gate, audit-before-
//      delete);
//   2. the RPC stays AUDITED — every code path inserts into admin_audit
//      before its effect;
//   3. the frontend wiring actually calls it with the force flag and only
//      from behind the type-to-confirm modal.
// Same source-invariant shape as tests/trip-road.test.ts's wiring pins.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL_PATH = '../supabase/migrations/20260916_admin_delete_user.sql'
const STORE_PATH = '../src/store/store.ts'
const PAGE_PATH = '../src/pages/AdminPage.tsx'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('admin_delete_user migration guards', () => {
  const sql = read(SQL_PATH)

  it('the function exists, security definer, and grants execute to authenticated', () => {
    expect(sql).toContain('create or replace function public.admin_delete_user(')
    expect(sql).toMatch(/admin_delete_user\(p_user_id uuid, p_force boolean default false\)/)
    expect(sql).toContain('security definer')
    expect(sql).toContain('grant execute on function public.admin_delete_user(uuid, boolean) to authenticated')
  })

  it('checks is_admin() inside the function body (the grant is only reachability)', () => {
    expect(sql).toMatch(/if not public\.is_admin\(\) then\s+raise exception 'admin only';/)
  })

  it('refuses self-deletion', () => {
    expect(sql).toMatch(/if p_user_id = auth\.uid\(\) then\s+raise exception 'cannot delete your own admin account';/)
  })

  it('refuses deleting the last masteradmin', () => {
    expect(sql).toContain("raw_app_meta_data ->> 'role' = 'masteradmin'")
    expect(sql).toContain("raise exception 'cannot delete the last admin account'")
  })

  it('PUBLISHED-ITINERARY PROTECTION: refuses without force, and the guard precedes the audit row', () => {
    expect(sql).toMatch(/from public\.published_itineraries where creator_id = p_user_id/)
    expect(sql).toMatch(/if v_pubs > 0 and not p_force then\s+raise exception 'user has % published itinerary/)
    const guardIdx = sql.indexOf("if v_pubs > 0 and not p_force then")
    const auditIdx = sql.indexOf("insert into public.admin_audit")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(auditIdx).toBeGreaterThan(guardIdx)
  })

  it('audit row is written in the SAME transaction, BEFORE the delete effect', () => {
    const auditIdx = sql.indexOf("insert into public.admin_audit")
    const deleteIdx = sql.indexOf('delete from auth.users where id = p_user_id')
    expect(auditIdx).toBeGreaterThan(-1)
    expect(deleteIdx).toBeGreaterThan(auditIdx)
    // the audit row records the blast radius
    expect(sql).toContain("'user.delete'")
    expect(sql).toContain("'email', v_email")
    expect(sql).toContain("'trips_owned', v_trips")
    expect(sql).toContain("'published', v_pubs")
    expect(sql).toContain("'force', p_force")
  })

  it('the deletion runs against auth.users (the cascade root), not just profiles', () => {
    // deleting only the profile row would orphan the auth account — sign-in
    // would still work against an empty shell
    expect(sql).toContain('delete from auth.users where id = p_user_id')
  })
})

describe('adminDeleteUser store + UI wiring', () => {
  const store = read(STORE_PATH)
  const page = read(PAGE_PATH)

  it('store calls the RPC with both parameters and restores the cache on error', () => {
    expect(store).toContain("supabase.rpc('admin_delete_user'")
    expect(store).toMatch(/admin_delete_user', \{ p_user_id: userId, p_force: force \}/)
    // optimistic patch covers every slice the cascade takes; error path restores them
    expect(store).toMatch(/export async function adminDeleteUser\(userId: ID, force = false\)/)
    const fnStart = store.indexOf('export async function adminDeleteUser')
    const fnEnd = store.indexOf('// ---------------- Trip deletion + undo ----------------', fnStart)
    const body = store.slice(fnStart, fnEnd)
    // #800: the profile catalogue is NOT one of these slices. It leaves through
    // the store's one install gate, so the authority revision is re-checked and
    // the stamp is rewritten — and a rollback cannot reinstate a private row the
    // authority no longer covers.
    for (const slice of ['trips:', 'published:', 'suggestions:', 'decisions:', 'activity:', 'notifications:']) {
      expect(body).toContain(slice)
    }
    expect(body).toContain('removeCatalogEntry(userId)')
    expect(body).toContain('trips: prevTrips, published: prevPubs,')
  })

  it('the UI gate is the type-to-confirm modal; the force flag rides the call', () => {
    expect(page).toContain('adminDeleteUser(target.id, deleteForce)')
    // email-typed confirmation (case-insensitive trim)
    // #800: the typed email is read through the narrowed local, because the
    // address exists only on a private row.
    expect(page).toMatch(/deleteName\.trim\(\)\.toLowerCase\(\) !== deleteTargetEmail\.trim\(\)\.toLowerCase\(\)/)    // the force checkbox only renders when the user has publications
    expect(page).toMatch(/pubs > 0 \? \([\s\S]*?deleteForce/)
    // never rendered for the admin's own row
    expect(page).toMatch(/\{u\.id !== meId && \(\s*<button[^>]*permanent/)
  })
})
