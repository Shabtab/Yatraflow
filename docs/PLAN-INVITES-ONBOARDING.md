# Execution plan — Invites & onboarding (M9)

> **Status:** Approved — planning complete, implementation not started.
> This is the **execution playbook** for M9. It is written so an executor (human
> or model) with no prior session context can implement it **without re-deriving
> design decisions**. Every decision below is already made; open questions are
> collected in §13 and must be answered before the phase that needs them.
> Live planning still lives in [`ROADMAP.md`](../ROADMAP.md) (the single plan of
> record); this file is the *how*, the roadmap is the *what/when*.

**Decision record (one line):** one unified `platform_invites` entity, shipped as
three releases — **R1 creator invites (C) → R2 referral (B) → R3 invite-only gate (A)**.

---

## 0. How to use this document

1. Read it **fully** before touching code. Do not skip §2 (what already exists) —
   duplicating the existing trip-invite system is the single biggest risk here.
2. Work **release by release**. R1 must be merged before R2 starts; R2 before R3.
   R3 is behind a flag and may be deferred indefinitely — that is a valid end state.
3. Within a release, work **phase by phase** (§3 → §11). Each phase has
   **Acceptance** criteria — do not move on until they pass.
4. After each release: run the full gate (§12.1), then follow the release
   checklist (§12.3). Never push to `main` without explicit user confirmation
   (AGENTS §2.1 / §2.8).
5. If you learn something a fresh session would need — a pitfall, a quirk, a
   "local lied, CI was right" moment — **add it to `AGENTS.md` in the same
   commit** (AGENTS §0 learning rule). Also add it to §14 of this file.

---

## 1. Scope & non-goals

**In scope**

- A platform-level invite entity that onboards people (users *and* creators)
  into YatraFlow, managed from the masteradmin console.
- Creator onboarding: an invited creator lands with `profiles.is_creator = true`
  and no demo-seed clutter.
- Referral loop: existing authenticated users mint invite links for friends.
- (Flagged) A hard invite-only signup gate enforced by a Supabase Auth hook.

**Explicit non-goals (do not build these)**

- **Do not change the existing trip-invite capability model.** `#/join/<code>`
  and `#/invite/<uuid>` keep working exactly as they do today. Platform invites
  get their own route (`#/access/<code>`) and their own code namespace.
- **No rewards/economics in R2.** Referral rewards are a *seam*, not a feature —
  M7 (payments) decides whether anything is paid out. Do not invent a currency,
  points system, or fee split here.
- **No email sending.** Supabase's own auth emails stay the only mail the app
  sends. R1/R2 never call an email provider.
- **No new component system** in the admin console — reuse the existing cards,
  tables, chips, `ConfirmDialog`, `EmptyState`.
- **No PII beyond what already exists.** `profiles` is publicly readable
  (`profiles read` policy, `schema.sql:335`), so invite attribution joins to it;
  do not add new personal columns to invites.

---

## 2. What already exists — extend, never duplicate

Read this table before writing any code. Every row is verified against the tree.

| Piece | Location | What it does |
|---|---|---|
| Trip invite code format | `src/lib/inviteCode.ts` | `<SLUG>-<4 chars>`; alphabet `TAIL_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY346789'` (:11), `INVITE_SEPARATOR` (:16), `makeInviteCode` (:45), `normalizeInviteCode` (:56), `looksLikeInviteCode` (:66), `inviteRoute` (:78) |
| Lazy code minting | `store.ts:777` `ensureInviteCode()` | writes `trips.invite_code`; unique index `idx_trips_invite_code` (`schema.sql:71`) |
| Code → trip lookup | `20260909_invite_codes.sql:65` `get_trip_by_invite_code(p_code)` | `security definer`, **granted to `anon`** (:76) — the code *is* the capability. Mirrored at `schema.sql:478` |
| Legacy UUID invites | `store.ts:721` `fetchSharedTrip(id, allowInvitePreview)` | still honoured by `#/invite/<uuid>` |
| Join route | `App.tsx:189` route comment; branches at `:211` + `:215` | `#/join/:code`, `#/invite/:tripId` → `InviteGate` |
| The auth round-trip | `App.tsx:593-610`, `:605`/`:606` buttons; `Auth.tsx:15` `nextRoute()`, validator `:19` | gate → `/auth?next=<encoded route>` → post-login redirect back |
| Join mutation | `store.ts:1522` `joinViaInvite()` | writes `trip_members` **first**, then activity + owner notification; idempotent for existing members |
| Self-join RLS | `schema.sql:368` `members insert` | `user_id = auth.uid()` — that is the join capability |
| Auth | `Auth.tsx`; `store.ts:227` `login` / `:246` `signup`; `schema.sql:228` `handle_new_user()` trigger | open signup; profile row auto-created |
| Masteradmin | `#/admin`, `src/pages/AdminPage.tsx`; `:60` tab render, `:274` `InvitesTab` (comment at `:278`: *"No invite-link table exists"*) | 7 tabs; `lib/admin.ts:8` `MASTERADMIN_ROLE`, `:15` `parseAdminRole`; `lib/adminSession.ts` cache |
| Admin RPCs + audit | `20260909_masteradmin.sql`: `is_admin()` :36, `is_disabled()` :53, deny-disabled :76, `admin read` :93, `admin write` :113, `admin_audit` :124, audit read :137, `admin_set_disabled` :155, `admin_set_creator` :188, `admin_unpublish` :270, `admin_delete_trip` :302 | audited `security definer` RPCs; audit row written **before** the effect |
| Creator flag | `profiles.is_creator` + `adminSetCreator` (`store.ts:1136`) | the grant an invite redemption issues |
| Store shape | `store.ts:28` `interface DB`, `:38` `adminAudit`, `:47` empty cache, `:377`/`:381` anonymous resets, `:408` hydrate, `:563` patch site, `:1102` `refreshAdminAudit` | `useSyncExternalStore` cache |
| Optimistic admin pattern | `store.ts:1113` `adminSetDisabled` | patch → commit → RPC → on `{ error }` rollback + toast |
| Realtime | `store.ts:2158-2165` channel registration; `lib/realtimeCore.ts:47` `isRecentLocalWrite`, `:25` member apply | per-table `postgres_changes` |
| Feature flags | `src/lib/featureFlags.ts:12` `AI_COMPANION_ENABLED` | build-time `VITE_*` switch; the pattern R3 copies |
| Demo seed | `store.ts:573` `seedIfEmpty && !admin` guard, `:594` `seedDemoFor` | every non-admin new account gets demo trips |
| Regression tests | `tests/join-invite.test.ts` (`vi.mock` at :19, imports :60, write-order describe :116, idempotency :151) | the pattern every new store test copies |

**Grepped and confirmed absent** — there is no waitlist, referral, `invited_by`,
`platform_invite`, or invite-only concept anywhere in the tree. This plan
introduces all of it; nothing is being re-skinned.

---

## 3. The unified data model (defined once, in R1)

Both tables are created in R1. R2 and R3 **add columns and RPCs, never rewrite
the tables** — that is the whole point of doing C → B → A on one entity.

```
platform_invites
  id          uuid pk default gen_random_uuid()
  code        text not null unique              -- 'YF-' + 8 chars, uppercase
  purpose     text not null check (purpose in ('member','creator'))
  email       text                              -- R1 required for 'creator'; R3 required for all
  max_uses    int  not null default 1 check (max_uses > 0)
  used_count  int  not null default 0 check (used_count >= 0)
  expires_at  bigint                            -- ms epoch; NULL = never
  revoked_at  bigint                            -- ms epoch; NULL = live
  trip_id     uuid references trips(id) on delete set null   -- optional "and join this trip"
  created_by  uuid references profiles(id) on delete cascade -- R2 reads this as the inviter
  kind        text not null default 'admin' check (kind in ('admin','user'))  -- R2
  note        text                              -- admin memo, free text
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint

platform_invite_redemptions
  invite_id   uuid not null references platform_invites(id) on delete cascade
  user_id     uuid not null references profiles(id) on delete cascade
  granted     jsonb not null default '{}'::jsonb  -- snapshot of what was granted
  at          bigint not null default (extract(epoch from now()) * 1000)::bigint
  primary key (invite_id, user_id)               -- idempotency BY CONSTRUCTION
```

### Why each field exists (do not "simplify" these away)

- **`used_count` + atomic check** — `max_uses` is only meaningful if the
  increment can't race. Redemption must be a single
  `update ... where used_count < max_uses returning` (see §5.3). Two concurrent
  redemptions of a 1-use code must not both succeed.
- **`(invite_id, user_id)` primary key** — a double-click, a StrictMode
  double-fire, or a retry after a network blip must be a **no-op**, not an error
  and certainly not a second grant. `join-invite.test.ts:151` already tests the
  same property for trip joins; mirror it.
- **`granted jsonb`** — the grant is *recorded*, not recomputed. If
  `is_creator` is later revoked by an admin, the redemption history still says
  what the invite originally conferred. Audit honesty.
- **`expires_at` / `revoked_at` as ms-epoch bigints** — matches the house
  convention (`admin_audit.at`, `trips.updated_at`). Do **not** introduce
  `timestamptz` for new columns; keep the numeric convention.
- **`trip_id` nullable + `on delete set null`** — a "come plan Goa with me"
  invite pre-joins the redeemer, but deleting the trip must not delete the
  invite record (nor block the delete).
- **`created_by` → `profiles(id)` with cascade** — deleting the inviter removes
  their invites. For admin-minted invites this is the admin's profile.

### Entropy rule (do not weaken)

Platform codes are **`YF-` + 8 characters** from an unambiguous alphabet:

- Trip codes are `4` chars from a 28-char alphabet ≈ **331k** combinations
  (`inviteCode.ts:11`) — fine for a low-sensitivity trip preview.
- Platform codes at 8 chars ≈ **28^8 ≈ 3.8 × 10^11** — appropriate for a code
  that (in R3) creates accounts and (in R1) grants the creator badge.
- **Alphabet:** reuse the same unambiguous set (`ABCDEFGHJKLMNPQRTUVWXY346789`)
  so users can read codes aloud. R2's user-minted codes have 30-day expiry and
  a `max_uses` cap, which is the real abuse control — not the length.

### Namespace separation (the reason for the `YF-` prefix)

Trip codes look like `GOABEACHWE-K7QF` (slug head + dash). Platform codes look
like `YF-8K3MNPQR`. The `YF` head is deliberately reserved: no trip slug can
be `yf` because... **it can** — a trip named "YF" would mint `YF-XXXX`.
Therefore the router (§7.1) must **not** disambiguate by shape alone. The rule is:

> `#/join/<code>` is *always* a trip code path. `#/access/<code>` is *always* a
> platform invite path. The **route** decides, never the string.

`looksLikeAccessCode()` exists only for (a) input validation and (b) letting the
landing code box route the user to the right gate — and for (b) it must **ask
the server** (`peek_platform_invite`) when the shape is ambiguous, not guess.

## 4. Release map

| Release | Theme | Ships | Flag? |
|---|---|---|---|
| **R1 — v0.48.0** | Creator invites (C) | migration + RPCs, `accessCode.ts`, store, `#/access/<code>` gate, Auth/Landing integration, masteradmin Invites-tab rebuild | No — additive |
| **R2 — v0.49.0** | Referral (B) | user-minted invites, `kind='user'`, rate limits, Profile "Invite a friend", console referral view | No |
| **R3 — v0.50.0** | Invite-only (A) | Supabase `before_user_created` hook + `consumed_by`, gated signup UX | **Yes** — `VITE_INVITE_ONLY` |

Version numbers assume the current `[Unreleased]` batch ships as **v0.47.0**
(ROADMAP line 222 already labels the shipped push-notification work v0.47.0).
**Re-derive this before bumping** — if the unreleased batch has shipped under a
different number, shift R1/R2/R3 accordingly.

---

## 5. Phase R1-A — database (mirror `20260909_masteradmin.sql`)

**File:** `supabase/migrations/20260911_platform_invites.sql`. Mirror the exact
shape of `20260909_masteradmin.sql` — the executor should open it alongside this
section and copy its conventions verbatim (headers, `security definer` +
`set search_path`, audit-before-effect, grant stanzas). Then **mirror the new
objects into `supabase/schema.sql`** in the same commit (check how
`20260909_invite_codes.sql`'s additions appear in `schema.sql:478`; there is no
standalone `schema.sql` diff-sync script in this repo).

### 5.1 Exports (all live in the migration file first)

| RPC | Grants | Purpose |
|---|---|---|
| `code_platform_invite(p_purpose, p_email, p_max_uses, p_expires_at, p_trip_id, p_note)` → `platform_invites` | admin role | atomic code mint (collision-avoiding), row inserted, audit row written |
| `peek_platform_invite(p_code)` → jsonb | `anon` | status only (valid/used/expired/revoked/kind/purpose) — **no email, no trip_id, no creator name out to anon** |
| `redeem_platform_invite(p_code)` → jsonb | authenticated | the atomic claim; row written to `platform_invite_redemptions`; `granted` snapshot; bumps `used_count`; audit row |
| `admin_list_platform_invites(from_t, to_t)` → setof table row | admin | console table feed |
| `admin_list_invite_redemptions(from_t, to_t)` → setof table row | admin | console redemption feed |
| `admin_revoke_platform_invite(p_id)` → void | admin | sets `revoked_at`; audit row |
| R3-only | — | `consume_platform_invite_code(p_code)` driving the `before_user_created` hook, plus a `consumed_by`/`consumed_at` pair for the audit trail |

### 5.2 RLS on the tables

**`platform_invites` — no direct row access by anyone.** `authenticated` may
`select` only `code, purpose, kind, expires_at, revoked_at` (status fields the
gate needs) — never `email`, `trip_id`, `note`. `insert`/`update`/`delete`:
no policies for reset/anonymous; all mutation flows through the RPCs, which do
their own `is_admin()` check. The tables themselves are **append-only through
RPCs**. Unlike `trip_members` (self-join by RLS), granting a join is *admin
authority*, not self-service — this is the key policy difference from §2's
`schema.sql:368`.

**`platform_invite_redemptions` — authenticated read for the redeemer**
(`user_id = auth.uid()`) so the store can hydrate "what did my redemption
grant"; no insert policy (RPC-only). This keeps the console's cross-user view
an RPC-admin privilege.

**Admin reads** reuse the `admin read` policy from `masteradmin` (is_admin →
all rows readable) so the console table can join invites→redemptions→profiles
without per-row RLS gymnastics.

### 5.3 The atomic redemption (correctness-critical)

`redeem_platform_invite` must be one statement that both claims and records:

```sql
update platform_invites
   set used_count = used_count + 1
 where code = p_code
   and revoked_at is null
   and (expires_at is null or expires_at > (extract(epoch from now()) * 1000)::bigint)
   and used_count < max_uses
 returning *;
```

- Then `insert into platform_invite_redemptions` with the `granted` snapshot —
  shielded by the `(invite_id, user_id)` PK so a re-fire is a no-op (`on
  conflict do nothing`).
- Then `update profiles set is_creator = true where id = auth.uid()` **if the
  purpose is 'creator'**.
- Then `insert into admin_audit`.
- All inside a single transaction. Add `%ROWTYPE` handling for the "already
  used" empty-return in the executor's **error path** — the response must say
  `used` or `expired`/`revoked` distinctly (the gate renders different copy).

### 5.4 Seed nothing; grant nothing to `service_role`

- **No seed** in the migration — like the masteradmin migration, this migration
  must be pure DDL. Code minting is a runtime admin action.
- **Do NOT grant** these RPCs to `service_role`. The migration is applied by a
  privileged role at migration time; runtime access is admin/anon/authed only.
- **Test the migration twice** against a throwaway staging project before
  merging (the `verify-google-places.mjs` pattern for a live-probe script, or
  `supabase db diff` locally). A second-apply run must be clean.

### 5.5 Acceptance (R1-A)

1. `20260911_platform_invites.sql` applies cleanly on a fresh project and is
   idempotent on re-apply.
2. `schema.sql` mirrors every object (run the full `npm run verify` gate to
   confirm nothing else broke — migrations aren't executed in CI, so the mirror
   is the repo's single source of truth for model shape used by tests/types).
3. `code_platform_invite` minted with `p_purpose='creator'` returns a `YF-XXXXXXXX`
   code; a second mint rarely collides and never errors on collision
   (retry-on-collision loop inside the RPC).
4. `peek_platform_invite` from anon sees only status fields.
5. `redeem_platform_invite` from a non-admin **fails**; from an authed user
   returns `{ valid: true }`, bumps `used_count`, writes a redemption row with
   the `granted` snapshot, sets `is_creator = true` for creator purposes.
6. Re-fire of the same redeem → empty/no-op (idempotent), not an error.

---

## 6. Phase R1-B — `src/lib/accessCode.ts`

**New small pure module** — for tests, `tests/access-code.test.ts`. Model it on
`src/lib/inviteCode.ts` (same style, same comment density). CRLF; anchor edits
on whole lines.

**Exports:**

```ts
export const ACCESS_PREFIX = 'YF-'
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY346789'  // reused from inviteCode.ts
export const CODE_LENGTH = 8
export const NORMALIZED = /^YF-[A-Z0-9]{8}$/   // note: accepts I/O/0/1 — normalize at mint

export function makeAccessCode(): string          // 'YF-' + 8 drawn from CODE_ALPHABET
export function normalizeAccessCode(raw: string): string
  // trim + uppercase; accept optional input without 'YF-' and re-add it
  // validate alphabet membership after normalization; throw TypeError on garbage
export function looksLikeAccessCode(raw: string): boolean
  // true if after normalizeAccessCode it matches NORMALIZED
  // **only** a shape check — never route by it (see §3 namespace rule)
export function accessRoute(code: string): string  // `#/access/${normalized}`
```

Do **not** put Supabase calls here — this module is pure string math. The peek
(`peek_platform_invite`) and the redemption live in the store (§7.3). Keep the
**alphabet shared** — import it from `inviteCode.ts` (`TAIL_ALPHABET`) or re-derive
from the same literal; do not let the two alphabets drift apart.

**Acceptance (R1-B):**

- `makeAccessCode()` returns `^YF-[ABCDEFGHJKLMNPQRTUVWXY346789]{8}$` (direct
  check, no `[A-Z0-9]` — I/O/0/1 must never appear).
- `normalizeAccessCode(' yf-8k3mnpqr ')` === `'YF-8K3MNPQR'` (lowercase input,
  whitespace, missing prefix).
- `normalizeAccessCode('YF-1234')` throws (too short). `looksLikeAccessCode`
  stays false for trip-code-shaped strings like `'GOABEACHWE-K7QF'`.
- `accessRoute(code)` returns the hash route the router will actually match.

---

## 7. Phase R1-C — store routes + gate

**Goal:** a code owner can redeem, and the *granted* result survives reloads.

### 7.1 Router (`src/App.tsx`)

Add one route by the existing branch at `:211`/`:215`:

- **New route** `#/access/:code` → `AccessGate` (a new page, below).
- **Never** map `#/join` to a platform code and never map `#/access` to a trip
  code. The route is the sole authority (§3 namespace rule).
- **Landing code box** — Landing.tsx already routes unknown codes somewhere; do
  NOT let it guess by shape. Extend it to call `peek_platform_invite` when the
  string is not a trip code, then route to `#/access/<normalized>` if valid;
  otherwise keep today's "not found" behaviour.

### 7.2 The auth round-trip (reuse, don't reinvent)

`Auth.tsx` already has `nextRoute()` + validator and `App.tsx:593-610` already
performs gate → `/auth?next=...` → redirect-back. Reuse exactly that. The gate
must render a different CTA for:

- **Anonymous** → "Sign in to claim" (button to `/auth?next=%23%2Faccess%2F<code>`).
  After login, the user lands back on the gate, which now shows the redeem
  button.
- **Authenticated-not-yet-redeemed** → "Claim my invite" → calls
  `redeemPlatformInvite(code)` (§7.3).
- **Authenticated-and-redeemed** → "You're in" state; if `trip_id` existed,
  offer "Open your trip" (`#/trips` will list it once `joinViaInvite` ran).
- **Used/expired/revoked** → distinct dead-end copy with a "Talk to us"
  mailto. **Priority order in the reducer:** revoked > expired > used > valid
  (an old revoked link must say revoked, not used).

### 7.3 Store additions (`src/store/store.ts`)

Extend `interface DB` + empty cache (`:47`) with:

```ts
invitesRedemptions: PlatformInviteRedemption[]  // my redemptions (hydrated)
platformInvite: { code: string; status: 'peeked'|'redeemed'|'error'; ... } | null
```

New functions (name them after the existing verbs):

| Function | Behaviour |
|---|---|
| `peekPlatformInvite(code)` | `supabase.rpc('peek_platform_invite', { p_code })` — **no write**. Result cached in `platformInvite`. Error → `{ status:'error', reason }` with reason discriminated server-side |
| `redeemPlatformInvite(code)` | optimistic patch → commit → `rpc('redeem_platform_invite')` → on `{ error }` rollback + toast (AGENTS: write-through pattern from `adminSetDisabled`) |
| `refreshMyRedemptions()` | hydrates `invitesRedemptions` from the authenticated-only select + `granted` jsonb |

**Anonymous reset** — `hydrateFromSupabase`'s anonymous branch (`:377`/`:381`)
sets `invitesRedemptions: []` and `platformInvite: null`. **The gate's "You're
in" state must survive a reload only via the auth branch** — do not persist the
un-authenticated peek in localStorage (a stale **valid** peek would let an
already-consumed code flash as claimable for one frame). Where the existing
code resets `adminAudit`/`members` for anonymous, add these two the same way.

**Schema mirror in types** — add `PlatformInvite` + `PlatformInviteRedemption`
interfaces next to the existing `Trip`/`Member` types after `schema.sql`'s
mirror lands, so RPC results type-check.

### 7.4 New page `src/pages/AccessGate.tsx`

Small, no new component system — model on `InviteGate` (read it first). One
`useEffect`-driven flow keyed on the route param:

```
[normalize code] → [peek] → [render by status × auth state]
```

**Acceptance (R1-C):**

- `#/access/YF-8K3MNPQR` renders: anonymous → "Sign in to claim"; authed unclaimed
  → "Claim my invite"; claimed → "You're in" (+ "Open your trip" when a trip was
  attached).
- After login via `/auth?next=`, the user returns to `#/access/...` and the same
  code now shows the claim button (no manual re-entry; session email matches
  what R1-A's redeem expects — see §13 Q1).
- Consumed/expired/revoked codes render the right dead-end copy; `#/join`
  behaviour and `#/invite` behaviour are untouched (regression check).
- A refresh mid-flow does not flash a claimable state for a consumed code.

---

## 8. Phase R1-D — masteradmin console (Invites tab rebuild)

`AdminPage.tsx:274` already has an `InvitesTab` stub (comment at `:278`: *"No
invite-link table exists"*). Rebuild it **in place** — do not add a new tab.

### 8.1 The mint form

- **Purpose** — segmented control (`.bench`-style `role="group"`) with
  **member / creator**, defaulting to creator (R1's headline).
- **Email** — required unless R1 lands without the email-bound decision (§13
  Q1); validation = one valid email per invite. **One code, one email** in R1.
- **Max uses** — number input, default 1, ≥1.
- **Expires** — date input producing ms epoch, optional (blank = never).
- **Trip attach (optional)** — a picker that searches the admin's *own* trips
  (do NOT expose every trip's title here) and stores `trip_id`.
- **Note** — free-text admin memo.

Submit → `store.codePlatformInvite(...)` (calls the mint RPC) → on success,
toast with the `YF-XXXXXXXX` code **or** directly show it inline with a
🎉 + copy button; add row to the table. **Mailto not required** — admin copies,
sends by whatever means they like (email is *not* in scope; §1.4).
**Disabled while submitting** + `aria-busy` (AGENTS: async input guards).

### 8.2 The table

Columns: **code** (mono) · **purpose** chip (member/creator) · **email** ·
**used** (`used_count/max_uses`) · **expires** (formatted via `formatHM`-family,
or `—` when never) · **status** chip (live / used-up / revoked / expired — derive
from the same reducer ordering as the gate) · **note** · **actions**
(revoke-only for live rows). Data from `admin_list_platform_invites`, refreshed
with the same `refreshAdminAudit`-style pattern (`store.ts:1102`). Add the
freeze-focus/audit notes where they belong (reuse `.admin-*` refs, don't style
new ones).

### 8.3 Revoke

`admin_revoke_platform_invite(id)` — audible (writes `admin_audit` with the
admin's id + the invite id + `revoked_at`). Confirm in the table dialog
(`ConfirmDialog`), then optimistically flip the chip to revoked.

### 8.4 Redemptions view (read-only)

Second small panel (or a tab section): recent redemption rows (invite code,
granted snapshot, user) from `admin_list_invite_redemptions`, newest first.
This is what proves to admins that (a) a link worked and (b) *what* it granted.

**Acceptance (R1-D):**

1. An admin mints a creator invite, sees the code, and the row appears with
   `used 0/1` and status `live`.
2. Non-admins calling the mint/redeem RPCs get an auth/`is_admin` error — the
   console path is the only mint surface.
3. After someone redeems, the row shows `1/1` + `used`; the redemptions panel
   shows the granted snapshot.
4. Revoke flips the chip to `revoked` and appends one audit row.
5. `npm run build` + reload of `#/admin` shows no stale-chunk mismatch.

---

## 9. Phase R1-E — creator onboarding flush (hide the demo seed, show the badge)

The demo-seed guard currently keys on `!admin` (`store.ts:573`
`seedIfEmpty && !admin`). An invited creator who lands with `is_creator = true`
would get demo trips — the opposite of a clean creator start. **Fix in R1.**

### 9.1 Seed guard

Change the seed condition so a creator flag skips seeding for that user
(**recommended**), pending §13 Q4:

```ts
seedIfEmpty && !admin && !isCreator
```

Wherever `is_creator` is already read (Profile page, hub gate), load it from
`profiles` — do not introduce a second source of truth. Keep the current
behaviour for everyone else; an existing creator who already has demo trips is
**not** the target of a data migration in R1 — only new accounts stop seeding.

### 9.2 Profile rendering

`Profile.tsx` components reading `is_creator` already render the creator hub
(`CreateTrip` + gated tabs). Verify the **badge/ribbon** reads the real column
and that a redeemed creator sees the hub immediately
(no refetch needed — the redeem RPC updated `profiles`; the store must refresh
`me`/`profile` after redemption if it caches it, per §7.3).

**Acceptance (R1-E):**

1. A brand-new creator account (redeemed → `is_creator = true`) shows **no demo
   trips** and lands directly in the creator hub.
2. A brand-new *member* account still gets the demo seed (regression).
3. Profile badge reflects the flag after reload; no double seed, no "empty
   trips" session for creators.

---

## 10. Phase R1-F — tests (node env, no DOM)

Follow the `tests/join-invite.test.ts` pattern (`vi.mock` the Supabase client,
route tables, await a microtask flush, assert the captured `.from`/`.rpc`
calls; `tests/store-persistence.test.ts` covers the mock-store pattern). Add:

**`tests/access-code.test.ts`** — pure string tests (acceptance list from §6).

**`tests/platform-invites.store.test.ts`** — store-level:

- `peekPlatformInvite` captures `rpc('peek_platform_invite', { p_code })`; error
  path stores `{ status:'error', reason }`.
- `redeemPlatformInvite` — optimistic-ish; assert the **write-through order**
  (rpc before commit, or the store's exact convention — follow what
  `adminSetDisabled` does: patch → commit → RPC → rollback on error).
- **Double-redeem idempotency** — two calls in one flush produce exactly one
  non-empty RPC result (the server also no-ops via the compound PK, but the
  store must not double-render).
- **Anonymous reset** — hydrate with no session leaves `invitesRedemptions: []`
  + `platformInvite: null` after the anonymous branch.

**`tests/invites-reducer-order.test.ts`** — the revoked > expired > used > valid
priority the gate depends on; pure function test.

Also extend the existing **route regression** file that already pins hash-route
behaviour (`#/join`/`#/invite`) with new cases: `#/access/<valid>` and
`#/access/<garbage>`.

**Acceptance (R1-F):** the new files run green under `npm test` and the full
`npm run verify` gate passes with the new tests included.

## 11. Phase R1-G — docs & lint sweep

- **`CHANGELOG.md`** — add an `[Unreleased]` bullet: *"Creator invites (R1):
  admins mint YF-… invites (member or creator) from the masteradmin console;
  invited creators start clean (no demo seed) with the badge already granted;
  `#/access/<code>` gate handles sign-in/claim/dead-end states."* Keep it one
  bold-lead sentence + short detail (AGENTS §6, Keep-a-Changelog).
- **`ROADMAP.md`** — add the M9 milestone row + pointer (the actual edit is in
  §15; make it in the same commit as the doc).
- **`docs/README.md`** — new row linking this plan under the reference/
  explanation rows.
- **`AGENTS.md`** — if any hard-won quirk surfaced (a gateway bug, an RLS
  surprise), add it to the relevant section **in the same commit**.
- **Grep sweep** — re-grep the new surfaces for the OLD behaviour's phrasing
  (AGENTS directive-reversal rule): `fallback`, `demo`, `early-access`,
  `invite-link table` comments. Any stale copy that claims writers can still
  self-grant, or that invites are trip-only, gets updated here.
- **`npm run lint`** — new files must be lint-clean (no eslint-disable to
  silence `react-hooks/exhaustive-deps` on the gate effect; the effect should
  depend on the route code + auth state).

---

## 12. Phase R1-H — verify & release gate

### 12.1 `npm run verify` (must pass in this order)

```
tsc -b --clean            # fresh typecheck (never trust incremental)
npm test                  # full suite — new tests included
npm run build             # the exact Vercel command: tsc -b && vite build
```

Then **`git diff --check`** (conflict markers invisible to the whole gate —
AGENTS), and `npm run lint`.

### 12.2 Manual smoke (via `npm run dev`)

Per AGENTS §2.7 — confirm the dev server serves *this* tree before linking
(fetch `http://localhost:5173/src/styles.css` for a branch marker token), then:

1. Admin mints a **creator** invite (`#/admin` → Invites), copies `YF-…`.
2. Open `#/access/<code>` in a private window → "Sign in to claim" →
   `/auth?next=`. Create a throwaway account → lands back on the gate →
   "Claim my invite" → "You're in"; toasts appear.
3. New creator account shows **no demo trips**, creator hub visible, badge on.
4. Console row shows `1/1` used; redemptions panel shows the granted snapshot.
5. Re-open the same link → dead-end copy; revoke a live invite → revoked copy.
6. Mobile width (≤720px) — gate CTAs, featured bar, admin form all ≥40px touch.
7. Dark theme on the gate and console (no black-on-navy).

### 12.3 Release checklist

- `git status -sb` first — confirm no foreign unpushed commits (AGENTS §2.4).
- Branch off `test`, not `main` (§2.8; report branch name + wait explicitly).
- Packaging: **CHANGELOG entry + `package.json` version bump + lockfile**
  (AGENTS §2.2) — R1 ships v0.48.0 (re-derive per §4).
- Merge sequence is C → B → A with R1 first — never ship R2 before R1.
- Vercel: `vite.config.ts` aborts a build when `VITE_SUPABASE_*` are missing
  (AGENTS §3) — local `npm run build` validates the same path; push, watch the
  deploy, then close with the PR merge checks.

---

## 13. Open questions (answer before the phase that needs them)

| # | Question | Default if unanswered | Needed by |
|---|---|---|---|
| Q1 | Is the **email field on a creator invite** just for the admin's reference, or is redemption **bound to the email/domain** (e.g., only `alice@yahoo.com` can claim an invite minted for `alice@yahoo.com`)? | **Reference-only** — redemption binds to `auth.uid()`, email shown to console only. (Stronger binding = R3-style hook work, not R1.) | R1-A schema (`email` nullable or required) + R1-C (claim button conditional) |
| Q2 | **Format** `YF-XXXXXXXX` (8 chars) — or a shorter 6 (`YF-XXXXXX`)? Entropy table: 8 ≈ 3.8×10^11, 6 ≈ 3×10^8 (still 10^3× the trip code space). | **`YF-` + 8** | R1-A migration + §6 module |
| Q3 | **Version numbers** v0.47/48/49/50 for Unreleased/R1/R2/R3 — or shift? | **v0.47 = current Unreleased** → R1 v0.48 → R2 v0.49 → R3 v0.50 | CHANGELOG + package.json at each release |
| Q4 | New creator account: **blank slate** (skip demo seed entirely) vs demo seed then "profile → clear" UX? | **Blank slate** (skip the seed when `is_creator`) | R1-E seed guard |

Answer as a batch before R1 coding starts. Defaults are the recommended paths.

## 14. Session log (append here as you work)

| Date | Commit / branch | What happened |
|---|---|---|
| 2026-09-11 | — | Plan written and approved; recon cleaned (no working-tree edits). |

## 15. ROADMAP merge (already applied 2026-09-11 in this session)

The two ROADMAP edits shipping with this doc are **already in the working tree**
(they land in the same commit as the doc; do not re-add them):

1. **Strategic-track milestone** — a `### M9 — Invites & onboarding` heading
   after M8's section (the roadmap's strategic track uses `###` heading
   sections, not table rows — follow that shape if you ever touch it):
   ```md
   ### M9 — Invites & onboarding (exec plan: docs/PLAN-INVITES-ONBOARDING.md)
   Creator invites (admins mint YF-… member/creator codes with audit + gate) →
   referral (R2) → invite-only gate (R3, flagged). R1 ships creator invites and a
   clean-slate creator onboarding (no demo seed + badge granted). Three releases on
   one `platform_invites` entity — detailed execution guide in
   [`docs/PLAN-INVITES-ONBOARDING.md`](docs/PLAN-INVITES-ONBOARDING.md).
   ```
2. **Idea-bank index row** — an `M9 — Invites & onboarding` row in the ROADMAP's **Idea bank
   → Tier 3** table (added 2026-09-11; this replaced the old "Idea pool" section, which was
   consolidated away), linking this doc. A fresh reader therefore finds the execution playbook
   from both the strategic track *and* the idea bank.

And `docs/README.md` got a new index row linking this playbook. None of the three
target files needs a second manual edit — verify the current state with
`git diff ROADMAP.md docs/README.md` before adding the §10–§11 changes.

<!-- APPEND-MARKER -->
