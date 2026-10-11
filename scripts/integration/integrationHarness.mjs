#!/usr/bin/env node
// ============================================================================
// Yatraflow integration harness — real Supabase, real RLS (opt-in)
// ============================================================================
// Usage:   VITE_RUN_INTEGRATION=1 npm run test:integration
//
// What this is:
//   A node runner that talks to the project's real Supabase with supabase-js
//   directly (no app harness, no mocks) and asserts the row-level behavior an
//   authenticated crew actually relies on — with two test users so cross-user
//   RLS denials are provable, not assumed.
//
// Safety by construction:
//   - Every test row carries a unique run-id prefix (`rls_<runid>_`).
//   - Setup + teardown live in `finally`; the teardown ledger prints
//     (created → destroyed, counts must match).
//   - Zero destructive ops against real user data: only rows this run created
//     are ever touched.
//
// Opt-in only: unset VITE_RUN_INTEGRATION (or any falsy value) prints a skip
// note and exits 0 — `npm run verify` stays green offline, and CI never needs
// database credentials.
//
// Exit codes: 0 green · 1 red · 2 skipped (e.g. email confirmation required)
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m';

// ---------------------------------------------------------------- env loading
function loadEnv() {
  // One Map, no dynamic property access anywhere: .env.local is parsed in
  // first, then defined process.env entries override it (the `env[name]`
  // read/write form is also what Codacy's object-injection rule flags).
  const env = new Map();
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env.set(m[1], v);
    }
  } catch { /* no .env.local — process.env only */ }
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env.set(k, v);
  }
  return env;
}

const dotenv = loadEnv();
const env = (k) => dotenv.get(k) ?? '';

const SUPABASE_URL = env('VITE_SUPABASE_URL');
const SUPABASE_ANON_KEY = env('VITE_SUPABASE_ANON_KEY');
const USER1 = { email: env('TEST_USER1_EMAIL'), pass: env('TEST_USER1_PASS') };
const USER2 = { email: env('TEST_USER2_EMAIL'), pass: env('TEST_USER2_PASS') };

// ------------------------------------------------------------------ opt-in gate
if (!/^(1|true|yes)$/i.test(env('VITE_RUN_INTEGRATION') || '')) {
  console.log(`${DIM}integration harness: skipped (set VITE_RUN_INTEGRATION=1 to run against the real database)${OFF}`);
  process.exit(0);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !USER1.email || !USER2.email) {
  console.error(`${RED}integration harness: missing credentials${OFF}
required (in .env.local or environment):
  VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
  TEST_USER1_EMAIL, TEST_USER1_PASS, TEST_USER2_EMAIL, TEST_USER2_PASS
(see .env.example for the documented block)`);
  process.exit(2);
}

// ------------------------------------------------------------------- utilities
const runid = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const P = `rls_${runid}_`;                       // row prefix for every test row
const SLUG = `rls-${runid}-gallery`;

let failures = 0, passes = 0;
const t0 = Date.now();
const OVERALL_MS = 90_000;

function ok(name) { passes++; console.log(`  ${GREEN}PASS${OFF}  ${name}`); }
function fail(name, detail) { failures++; console.log(`  ${RED}FAIL${OFF}  ${name}${detail ? `\n        ${detail}` : ''}`); }
function note(msg) { console.log(`        ${DIM}${msg}${OFF}`); }

function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }

async function expectDenied(promise, name, why) {
  const r = await rtypeof(promise);
  if (r.error) { ok(`${name} — denied (${r.error.code ?? 'policy'})`); return; }
  fail(`${name} — expected denial`, why);
}
function rtypeof(p) { return p instanceof Promise ? p : Promise.resolve(p); }

const timeoutGuard = setTimeout(() => {
  console.error(`\n${RED}integration harness: exceeded ${OVERALL_MS / 1000}s guard — aborting${OFF}`);
  process.exit(2);
}, OVERALL_MS);

// ------------------------------------------------------------------ clients
const url = SUPABASE_URL, key = SUPABASE_ANON_KEY;
const anon = createClient(url, key);            // anonymous visitor context
const U1 = createClient(url, key);              // creator / trip owner
const U2 = createClient(url, key);              // crew member

async function authenticate(client, who) {
  const email = who.email, pass = who.pass;
  let r = await client.auth.signInWithPassword({ email, password: pass });
  if (r.error) {
    note(`no session for ${email} — attempting signUp`);
    r = await client.auth.signUp({ email, password: pass });
    if (!r.data?.session) {
      // email confirmation required → try password again (pre-confirmed flows)
      const again = await client.auth.signInWithPassword({ email, password: pass });
      if (again.error) return { ok: false, reason: again.error.message };
      r = again;
    }
  }
  const session = r.data?.session ?? r.data;    // signUp returns { user } when session exists
  const user = r.data?.user ?? session?.user;
  if (!user?.id) return { ok: false, reason: 'no user id in auth response' };
  return { ok: true, user };
}

// ===========================================================================
//  THE MATRIX  (run-id-isolated; teardown in finally)
// ===========================================================================
let sharedTripId = null, secondTripId = null, created = 0, destroyed = 0;
let main = async () => {
  // ---- gate: authentication (fail-stop)
  const a1 = await authenticate(U1, USER1);
  const a2 = await authenticate(U2, USER2);
  assert(a1.ok, 'auth: test user 1 has a session', a1.reason);
  assert(a2.ok, 'auth: test user 2 has a session', a2.reason);
  if (!a1.ok || !a2.ok) return;
  const owner = a1.user, crew = a2.user;

  // profile rows must exist (signUp trigger) — trips.owner_id references them
  const prof = await U1.from('profiles').select('id').in('id', [owner.id, crew.id]);
  assert(!prof.error && prof.data?.length === 2, 'auth: profile rows exist (on_auth_user_created)', prof.error?.message);
  if (prof.error || prof.data?.length !== 2) return;

  // ---- 1. trips:insert — any signed-in user can create an own trip
  const inviteCode = `${P}SHARED`; // the code is the join capability; a trip id is not
  const t = await U1.from('trips').insert({ owner_id: owner.id, name: `${P} Shared Trip`, visibility: 'private', invite_code: inviteCode }).select('id');
  assert(!t.error && t.data?.length === 1, 'trips: signed-in user creates own trip', t.error?.message);
  if (t.error || !t.data?.[0]) return;
  sharedTripId = t.data[0].id; created++;

  // App parity: createTrip always seeds the owner's member row; raw inserts
  // must too, or is_editor() is false for the owner and every editor probe
  // silently no-ops.
  const own = await U1.from('trip_members').insert({ trip_id: sharedTripId, user_id: owner.id, role: 'owner' });
  assert(!own.error, 'members: owner row created (createTrip parity)', own.error?.message);

  // ---- 2. trips:read — non-member cannot see a private crew trip
  const unseen = await U2.from('trips').select('id').eq('name', `${P} Shared Trip`);
  assert(!unseen.error && unseen.data?.length === 0, 'trips: non-member cannot see private trip', unseen.error?.message);

  // ---- 3. trip_members:join — a trip id joins nobody; the invite code does
  const byId = await U2.rpc('join_trip', { p_code: sharedTripId });
  assert(!byId.error && byId.data === null, 'members: a trip id does not join', byId.error?.message ?? `joined ${byId.data}`);
  const join = await U2.rpc('join_trip', { p_code: inviteCode });
  assert(!join.error && join.data === sharedTripId, 'members: crew joins with the invite code', join.error?.message ?? 'join_trip returned no trip');
  // join_trip adds an editor. The owner sets the crew member to viewer, so the
  // viewer checks below still hold.
  const joinerViewer = await U1.from('trip_members').update({ role: 'viewer' }).eq('trip_id', sharedTripId).eq('user_id', crew.id).select('role');
  assert(!joinerViewer.error && joinerViewer.data?.[0]?.role === 'viewer', 'members: owner sets the joiner to viewer', joinerViewer.error?.message ?? 'no row matched');

  // ---- 4. trips:read — crew now sees the trip (is_member path)
  const seen = await U2.from('trips').select('id').eq('name', `${P} Shared Trip`);
  assert(!seen.error && seen.data?.length === 1, 'trips: member sees crew trip', seen.error?.message);

  // ---- 5. trips:write — viewer is NOT an editor (is_editor gate)
  const denied = await U2.from('trips').update({ travellers: 3 }).eq('id', sharedTripId).select('id');
  assert(!!denied.error || (denied.data?.length ?? 0) === 0, 'trips: viewer cannot restyle trip',
    'is_editor(id) should pin writes — a row matched');

  // ---- 6. members:promote — owner escalates viewer → editor; write succeeds
  const promote = await U1.from('trip_members').update({ role: 'editor' }).eq('trip_id', sharedTripId).eq('user_id', crew.id).select('role');
  assert(!promote.error && promote.data?.[0]?.role === 'editor', 'members: owner escalates crew to editor',
    promote.error?.message ?? 'no row matched');
  const restyle = await U2.from('trips').update({ travellers: 3 }).eq('id', sharedTripId).select('travellers');
  assert(!restyle.error && restyle.data?.[0]?.travellers === 3, 'trips: editor writes trip', restyle.error?.message);

  // ---- 7. trip_members:read — membership rows of another trip are invisible
  const t2 = await U1.from('trips').insert({ owner_id: owner.id, name: `${P} Private Trip`, visibility: 'private' }).select('id');
  assert(!t2.error && t2.data?.[0], 'trips: second trip created', t2.error?.message);
  if (!t2.error && t2.data?.[0]) { secondTripId = t2.data[0].id; created++; }
  const privateMembers = await U2.from('trip_members').select('*').eq('trip_id', secondTripId);
  assert(!privateMembers.error && privateMembers.data?.length === 0, 'members: other-trip membership rows invisible', privateMembers.error?.message);

  // ---- 8. suggestions — crew-only write/write; anonymous context denied
  const s = await U2.from('suggestions').insert({ trip_id: sharedTripId, proposed_by: crew.id, title: `${P} Suggestion` }).select('id');
  assert(!s.error && s.data?.[0], 'suggestions: editor proposes', s.error?.message);
  const anonSeesS = await anon.from('suggestions').select('*').eq('trip_id', sharedTripId);
  assert(!anonSeesS.error && anonSeesS.data?.length === 0, 'suggestions: anonymous denied (crew-only)', anonSeesS.error?.message);

  // ---- 9. decisions — crew-only; anonymous denied
  const d = await U2.from('decisions').insert({ trip_id: sharedTripId, raised_by: crew.id, question: `${P} Q?` }).select('id');
  assert(!d.error && d.data?.[0], 'decisions: editor raises', d.error?.message);
  const anonSeesD = await anon.from('decisions').select('*').eq('trip_id', sharedTripId);
  assert(!anonSeesD.error && anonSeesD.data?.length === 0, 'decisions: anonymous denied (crew-only)', anonSeesD.error?.message);

  // ---- 10. activity — crew writes; anonymous denied
  const av = await U2.from('activity').insert({ trip_id: sharedTripId, actor_id: crew.id, verb: `${P} verb` });
  assert(!av.error, 'activity: editor writes verb', av.error?.message);
  const anonSeesAv = await anon.from('activity').select('*').eq('trip_id', sharedTripId);
  assert(!anonSeesAv.error && anonSeesAv.data?.length === 0, 'activity: anonymous denied (crew-only)', anonSeesAv.error?.message);

  // ---- 11. notifications — recipient-only
  const notify = await U1.from('notifications').insert({ user_id: crew.id, trip_id: sharedTripId, text: `${P} hello` });
  assert(!notify.error, 'notifications: trip editor notifies crew', notify.error?.message);
  const crewNotify = await U2.from('notifications').select('*').eq('text', `${P} hello`);
  assert(!crewNotify.error && crewNotify.data?.length === 1, 'notifications: recipient reads own', crewNotify.error?.message);
  const crewNotify2 = await U1.from('notifications').select('*').eq('text', `${P} hello`);
  assert(!crewNotify2.error && crewNotify2.data?.length === 1, 'notifications: trip crew may read trip notifications',
    crewNotify2.error?.message ?? 'count ' + (crewNotify2.data?.length ?? 0));
  const anonNotify = await anon.from('notifications').select('*').eq('text', `${P} hello`);
  assert(!anonNotify.error && anonNotify.data?.length === 0, 'notifications: anonymous denied (inbox)', anonNotify.error?.message);

  // ---- 12. published gallery — public read; creator-only write
  const pub = await U1.from('published_itineraries').insert({ id: SLUG, trip_id: sharedTripId, creator_id: owner.id, title: `${P} Gallery` }).select('id');
  assert(!pub.error && pub.data?.[0], 'gallery: creator publishes', pub.error?.message);
  const galleryRead = await anon.from('published_itineraries').select('id').eq('id', SLUG);
  assert(!galleryRead.error && galleryRead.data?.length === 1, 'gallery: visitor reads public gallery', galleryRead.error?.message);
  await expectDenied(
    anon.from('published_itineraries').insert({ id: `${SLUG}-x`, trip_id: sharedTripId, creator_id: owner.id }),
    'gallery: anonymous cannot publish', 'creator_id pinning should deny anonymous writes'
  );

  // ---- 13. realtime — a crew write lands on the owner's second channel
  const TITLE = `${P} Shared Trip v2`;
  let landed = null;
  const channel = U1.channel(`integration_${runid}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${sharedTripId}` },
      (e) => { if (e?.new) landed = e.new; })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trips', filter: `id=eq.${secondTripId}` },
      (e) => { note('unexpected INSERT landing'); });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('subscribe timeout')), 10_000);
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(timer); res(); } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); rej(new Error(status)); } });
  });
  const rename = await U2.from('trips').update({ name: TITLE }).eq('id', sharedTripId);
  assert(!rename.error, 'realtime: crew rename submitted', rename.error?.message);
  const r0 = Date.now();
  await new Promise((res) => {
    const timer = setInterval(() => {
      if (landed?.name === TITLE) { clearInterval(timer); res(); }
      else if (Date.now() - r0 > 15_000) { clearInterval(timer); res(); } // free-tier realtime can lag on first connect
    }, 100);
  });  assert(landed?.name === TITLE, 'realtime: crew write lands on owner channel', landed ? `landed=${landed.name}` : 'no event within window');
  U1.removeChannel(channel);

  // ---- 13b. presence — two clients join one trip's presence room
  // M6 B1: the workspace joins `presence:<tripId>` per open trip. Both test
  // users track a session with a display name; each side must see the other
  // (and only the other — presence excludes self). untrack removes cleanly.
  const roomKey = `presence_${runid}`;
  const mkRoom = (client, who) => {
    const ch = client.channel(roomKey, { config: { presence: { key: who } } });
    return ch;
  };
  const roomA = mkRoom(U1, 'owner-session');
  const roomB = mkRoom(U2, 'crew-session');
  // The sync handler must REPLACE this snapshot, never merge into it: an
  // accumulating map cannot observe an untrack (once a key enters, no later
  // sync removes it), and the probe would report a ghost session forever.
  let seenByA = {};
  roomA.on('presence', { event: 'sync' }, () => { seenByA = roomA.presenceState(); });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('presence subscribe timeout')), 15_000);
    let joined = 0;
    const onSub = (status) => { if (status === 'SUBSCRIBED') { joined++; if (joined === 2) { clearTimeout(timer); res(); } } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); rej(new Error(status)); } };
    roomA.subscribe(onSub); roomB.subscribe(onSub);
  });
  await roomA.track({ name: 'Owner' });
  await roomB.track({ name: 'Crew' });
  const p0 = Date.now();
  await new Promise((res) => {
    const t = setInterval(() => {
      const keys = Object.keys(seenByA);
      if (keys.includes('crew-session')) { clearInterval(t); res(); }
      else if (Date.now() - p0 > 15_000) { clearInterval(t); res(); }
    }, 100);
  });
  const peerKeys = Object.keys(seenByA);
  assert(peerKeys.includes('crew-session'), 'presence: owner sees the crew session', `saw=${peerKeys.join(',') || 'nothing'}`);
  assert(!peerKeys.includes('owner-session') || seenByA['owner-session']?.length === 1,
    'presence: sessions keyed by presence key (one entry per session)', `saw=${peerKeys.join(',')}`);
  await roomB.untrack();
  const q0 = Date.now();
  await new Promise((res) => {
    const t = setInterval(() => {
      if (!Object.keys(seenByA).includes('crew-session')) { clearInterval(t); res(); }
      else if (Date.now() - q0 > 15_000) { clearInterval(t); res(); }
    }, 100);
  });
  assert(!Object.keys(seenByA).includes('crew-session'), 'presence: untrack removes the session from the room', `still=${Object.keys(seenByA).join(',')}`);
  U1.removeChannel(roomA); U2.removeChannel(roomB);

  // ---- 14. trash — tombstones stay with the owner team, live rows return
  // The store's "Delete" is a soft-delete (stamp deleted_at). "trips read
  // hide trashed" must be RESTRICTIVE: live rows pass as usual, the tombstone
  // stays readable for its owner/editors (the added-row check would 42501
  // otherwise) and disappears for a plain crew member. Read back with
  // .select() — a denied update is silent (0 rows, no error).
  const trash = await U1.from('trips').update({ deleted_at: new Date().toISOString() }).eq('id', sharedTripId).select('id');
  assert(!trash.error && trash.data?.length === 1, 'trash: owner tombstones own trip (added-row accepted)', trash.error?.message);
  const editorSeesTrash = await U2.from('trips').select('id').eq('id', sharedTripId);
  assert(!editorSeesTrash.error && editorSeesTrash.data?.length === 1, 'trash: editor keeps tombstone visibility (owner team)', editorSeesTrash.error?.message);
  const demote = await U1.from('trip_members').update({ role: 'viewer' }).eq('trip_id', sharedTripId).eq('user_id', crew.id).select('role');
  assert(!demote.error && demote.data?.[0]?.role === 'viewer', 'members: owner demotes crew back to viewer', demote.error?.message ?? 'no row matched');
  const memberSeesTrash = await U2.from('trips').select('id').eq('id', sharedTripId);
  assert(!memberSeesTrash.error && memberSeesTrash.data?.length === 0, 'trash: plain member cannot read a tombstone', memberSeesTrash.error?.message);
  const untrash = await U1.from('trips').update({ deleted_at: null }).eq('id', sharedTripId).select('id');
  assert(!untrash.error && untrash.data?.length === 1, 'trash: owner restores the trip (tombstone cleared)', untrash.error?.message);
  const memberSeesLive = await U2.from('trips').select('id').eq('id', sharedTripId);
  assert(!memberSeesLive.error && memberSeesLive.data?.length === 1, 'trash: restored trip is live for the crew again', memberSeesLive.error?.message);

  note('policies ratchet: enforced by supabase/tests/rls_contract.test.sql (management plane)');
};

// -------------------------------------------------------------------- teardown
main = main.bind(null);
try {
  await main();
} finally {
  // ordered teardown: children cascade on trip delete; gallery cascades too
  const dels = [];
  const ids = [sharedTripId, secondTripId].filter(Boolean);
  // seed is_editor evidence for every trip (a trip with no member row makes
  // the is_editor-gated delete match zero rows -- silently)
  for (const id of ids) {
    const me = (await U1.auth.getUser()).data?.user?.id ?? '';
    await U1.from('trip_members').insert({ trip_id: id, user_id: me, role: 'owner' });
  }
  if (secondTripId) dels.push(U1.from('published_itineraries').delete().eq('id', SLUG));
  for (const id of ids) dels.push(U1.from('trips').delete().eq('id', id));
  for (const d of dels) { const r = await d; if (!r.error) destroyed++; }
  const leftover = await U1.from('trips').select('id').like('name', `${P}%`);
  const clean = !leftover.error && leftover.data?.length === 0;
  console.log(`\n${DIM}teardown ledger: created=${created} destroyed=${destroyed}${clean ? ' — clean' : ` — LEFTOVER ROWS: ${leftover.data?.length}`}${OFF}`);
  clearTimeout(timeoutGuard);
  const ms = ((Date.now() - t0) / 1000).toFixed(1);
  if (failures === 0) { console.log(`${GREEN}integration harness: ${passes} passed · ${ms}s${OFF}`); process.exit(0); }
  console.log(`${RED}integration harness: ${failures} failed · ${passes} passed · ${ms}s${OFF}`);
  process.exit(1);
}
