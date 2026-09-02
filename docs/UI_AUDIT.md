# YatraFlow — UI Audit Report

**Audited:** 2026-09-01 · release `0.22.0` · commit `b793381` (`main`)
**Scope:** every user-facing surface — app shell (`src/App.tsx`), pages (`src/pages/*`), shared components (`src/components/*` incl. `ui.tsx`, `ImpactPreview`, `StopEditor`, `LocationInput`, `AiDrawer`, `TripMap`), and the design system (`src/styles.css`, `index.html`).
**Method:** rule-by-rule pass against the [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines), cross-checked with WCAG 2.2 AA (labels, focus, live regions, target sizes), mobile-web standards (touch, safe areas, iOS zoom), and internal consistency against `../DESIGN_TOKENS.md` + `../AGENTS.md` §4 conventions. Every finding cites `file:line` and includes a concrete example fix.

## Severity & effort key

| Tag | Meaning |
|---|---|
| **P0** | Blocks a task for users with disabilities, or visibly broken theming — fix first |
| **P1** | Major UX/a11y gap (keyboard, touch, data-loss, state-in-URL) |
| **P2** | Polish / consistency / copy |

| Tag | Meaning |
|---|---|
| **S** | < 30 min · **M** | 30–90 min · **L** | half-day+ |

> Note on testing: CSS-only findings are invisible to `tsc` + vitest (repo lesson, `../AGENTS.md` §4 issue #14) — the `vite build` in `npm run verify` is the only gate that catches CSS syntax slips.

## Executive summary

The app is in good shape for an MVP: a real 3-layer token system, a focus-trapped modal, live-region toasts, an ARIA combobox, undo affordances for destructive actions, and a documented z-index ladder. The audit found **32 findings — 2×P0, 15×P1, 15×P2** — concentrated in five clusters:

1. **Form-label association is missing globally** (one fix in `Field` covers ~30 call sites).
2. **Dark mode stops at colors** — no `color-scheme`, no `theme-color`, so native controls/scrollbars render light inside a dark UI.
3. **Touch/mobile hygiene gaps** — no `touch-action`, no `overscroll-behavior: contain`, no safe-area insets.
4. **Motion & focus polish** — `prefers-reduced-motion` guards one animation out of ~8; the focus ring misses a dozen interactive selectors.
5. **State & navigation semantics** — workspace tabs and Explore filters aren't in the URL; navigation uses `<button>` where `<a href="#/…">` is free in a hash router.

### Scorecard

| Category | Verdict |
|---|---|
| Accessibility — labels & ARIA | ❌ 6 findings (1 P0) |
| Focus states | ⚠️ 1 finding (ring coverage) |
| Forms | ❌ 4 findings (autocomplete, validation focus, unsaved-changes guard) |
| Animation & motion | ❌ 1 systemic finding |
| Typography | ⚠️ 2 findings |
| Content handling / images | ⚠️ 2 findings (mostly pass) |
| Navigation & state (URL) | ❌ 2 findings + 1 dead-state |
| Touch & interaction | ❌ 3 findings |
| Safe areas & layout | ❌ 2 findings |
| Dark mode & theming | ❌ 3 findings (1 P0) |
| Performance | ✅ pass (1 optional note) |
| Locale & i18n | ⚠️ 1 finding |
| Content & copy | ⚠️ 1 finding |
| Anti-pattern checklist | ✅ 14/16 clean (see §16) |

## What's already strong (keep these patterns)

- **Token architecture** — primitives → `--color-*` semantics → components; documented state matrix (`../DESIGN_TOKENS.md`); legacy aliases intact.
- **Modal quality** (`src/components/ui.tsx:21-75`) — focus trap, Escape, scroll-lock + restore, `aria-modal`, labelled by title, restores previous focus.
- **Toast system** (`src/components/ui.tsx:140`) — `role="status" aria-live="polite"`, plus `undoToast` for destructive actions (e.g. `TripsList.tsx:19-22`) and `ConfirmDialog` before deletes (`TripsList.tsx:88-96`).
- **Combobox ARIA** (`src/components/LocationInput.tsx:101-131`) — `role="combobox"`, `aria-activedescendant`, listbox/option roles, keyboard nav.
- **No-anti-pattern record** — no `transition: all`, no `alert()/confirm()`, no paste-blocking, no `user-scalable=no`, no `outline: none` without replacement (`.trip-card-hit` even pairs `all: unset` with its own `:focus-visible` ring, `styles.css:957-958` — the model to follow).
- **Mobile inputs** — 16px font + ≥44px targets in the 720px block (`styles.css:1227-1229`), preventing iOS zoom.
- **Performance posture** — MapLibre lazy chunk (`TripWorkspace.tsx:27-28`), font `preconnect` + `display=swap`, thumbnails `loading="lazy"` + `alt=""`.
- **Empty states everywhere** (`EmptyState` component), clamped long descriptions (`ClampedText`, `TripWorkspace.tsx:556-585`), tabular figures already on timeline clocks (`styles.css:795`).

---
## 1. Accessibility

### F-01 · P0 · `Field` renders a visual label that is associated with nothing
**Where:** `src/components/ui.tsx:102-116` — `<label className="label">{props.label}</label>` has no `htmlFor` and no `id` on the control. Every `Field` consumer is affected: `Auth.tsx:68-73`, `CreateTrip.tsx:258-275`, `StopEditor.tsx` (all ~14 fields), `Profile.tsx:44-47,64-72,87-90`, `TripWorkspace.tsx` Suggestions/Budget/Decisions forms. Screen readers announce bare inputs ("edit text"), and clicking the label does not focus the control.
**Fix (shared, one place):** generate an id with `useId` (already imported in `ui.tsx`), put it on the label's `htmlFor`, and inject it into the child control via `cloneElement`:

```tsx
export function Field(props: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  const id = useId()
  const child = React.Children.toArray(props.children).find(React.isValidElement) as React.ReactElement | undefined
  const control = child && typeof child.type === 'string'          // plain <input>/<select>/<textarea>
    ? React.cloneElement(child as React.ReactElement<{ id?: string }>, { id })
    : props.children                                               // composites handle id below
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{props.label}</label>
      {control}
      {props.hint && !props.error && <span className="hint-text" id={`${id}-hint`}>{props.hint}</span>}
      {props.error && <span className="err-text" id={`${id}-err`} role="alert">{props.error}</span>}
    </div>
  )
}
```

**Composite children** (`LocationInput`, the clock-format chips) can't take an `id` prop yet — add an optional passthrough and forward it to the inner input:

```tsx
// LocationInput.tsx
export function LocationInput({ inputId, … }: Props & { inputId?: string }) { … <input id={inputId} … /> }
// call sites inside <Field label="Area">: <LocationInput inputId={/* see note */} … />
```

For chip-row "fields" (clock format, travel styles, trip emoji) the label can't point at one control — wrap the row in `<fieldset><legend className="label">…` or give each chip an `aria-label`. All changes stay inside `ui.tsx` + `LocationInput.tsx`; the ~30 call sites keep compiling unchanged.
**Effort:** M. **Verify:** tab into any form → VoiceOver/NVDA announces "label, edit text"; clicking labels focuses inputs.

### F-02 · P1 · Icon-only buttons rely on `title` alone
**Where:** `src/pages/TripWorkspace.tsx:874-876` (`✔️` / `❓` / `↔️` stop actions), `src/components/TripMap.tsx:572-576` (ⓘ key toggle). `title` is an unreliable accessible name (touch devices never show it; some SR configurations skip it).
**Fix:** mirror the existing pattern from `ui.tsx:67` (`aria-label="Close"`):

```tsx
<button className="icon-btn" title="Mark confirmed" aria-label={`Mark ${s.title} confirmed`} onClick={() => onStatus(s, 'confirmed')}>✔️</button>
<button className="icon-btn" title="Move to another day" aria-label={`Move ${s.title} to another day`} onClick={() => onMoveBetweenDays(s)}>↔️</button>
<button className="map-legend-toggle" title={…} aria-label={legendOpen ? 'Hide the map key' : 'Show the map key'} …>
```

**Effort:** S.

### F-03 · P1 · ConfirmDialog puts initial focus on the destructive button
**Where:** `src/components/ui.tsx:49-53` focuses the first control; `ConfirmDialog` (`ui.tsx:88-98`) renders confirm first → "Delete trip" is pre-focused. One accidental Enter destroys data (the undo toast saves it, but the flow shouldn't invite the mistake).
**Fix:** give `Modal` an `initialFocus` selector and let `ConfirmDialog` request the cancel button:

```tsx
// Modal — focus resolution order: explicit initialFocus → input → [data-autofocus] → first button
const t = setTimeout(() => {
  const el = (initialFocus && dialogRef.current?.querySelector<HTMLElement>(initialFocus))
    ?? bodyRef.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select')
    ?? dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    ?? dialogRef.current?.querySelector<HTMLElement>('button')
  el?.focus()
}, 30)

// ConfirmDialog — cancel is the safe default; confirm stays opt-in
<button data-autofocus className="btn btn-outline btn-sm" onClick={onClose}>{cancelLabel}</button>
```

**Effort:** S–M.

### F-04 · P1 · Async updates without live regions
Three surfaces change state silently for screen readers:
- **AI companion chat** — new replies (`src/components/AiDrawer.tsx:61-71`) are not announced. Add `aria-live="polite"` to the log container (keep scroll behaviour on the inner element): `<div className="ai-msgs" ref={scrollRef} role="log" aria-live="polite">`.
- **Form errors** — `Auth.tsx:74`, `CreateTrip.tsx` (inline `errs.*`), `StopEditor.tsx` errors render as plain text. `Field`'s error span should carry `role="alert"` (folded into the F-01 rewrite), and `Auth`'s standalone error div becomes `<div className="err-text" role="alert">`.
- **Explore result count** — filtering changes the grid with no announcement. Add a polite status line: `<p className="sr-only" role="status">{pubs.length} itineraries match</p>`.

**Effort:** S each.

### F-05 · P1 · Inputs identified only by placeholder
Placeholders disappear on input and are not a substitute for an accessible name:
- `src/pages/Explore.tsx:67-68` — search input → add `aria-label="Search destination or creator"`.
- `src/components/AiDrawer.tsx:82-87` — chat input → `aria-label="Ask the travel companion"`.
- `src/pages/TripWorkspace.tsx:1796` — comment input → `aria-label="Add a comment"`.
- `src/pages/TripWorkspace.tsx:1159-1163` — halt-minutes number input (has `title` only) → `aria-label="Halt length in minutes"`.
- `src/pages/TripWorkspace.tsx:696-703` — inline day-title editor → `aria-label={`Rename Day ${day.index + 1}`}` and `aria-label` the confirm/cancel pair.

**Effort:** S.

### F-06 · P1 · Navigation is done with `<button>`s — no link semantics
**Where:** top-nav links `src/App.tsx:182-190` (`.nav-link` buttons incl. mobile menu), hero CTAs `src/pages/Landing.tsx:19-20,100`, trip cards `src/pages/TripsList.tsx:58`, Explore cards `src/pages/Explore.tsx:102`. `<button onClick={navigate}>` loses middle-click / Cmd-click / "open in new tab", browser hover-status URL, and find-in-page link semantics. In a **hash router** the fix is free — the href is literally the route string.
**Fix:**

```tsx
// App.tsx — same class, real anchor; keep the button only for menu/notif toggles
<a className={`nav-link ${route === '/trips' ? 'active' : ''}`} href="#/trips">🏕️ My trips</a>

// Landing.tsx
<a className="btn btn-primary btn-lg" href="#/auth?mode=signup">Start planning free</a>

// TripsList.tsx / Explore.tsx — also fixes F-07: <a> may contain <h3>/<div>, <button> may not
<a className="trip-card-hit" href={`/trip/${t.id}`} aria-label={undefined}>
  <div className="itin-emoji">…</div> …
</a>
```

Keep `onNavigate` for programmatic navigation after actions (import, copy). CSS needs one addition since `a` defaults differ from buttons: `.nav-link, .trip-card-hit { text-decoration: none; color: inherit; }` (`.trip-card-hit` already `all: unset`).
**Effort:** M (mechanical across 4 files).

### F-07 · P2 · Trip cards are `<button>` wrapping block content
`TripsList.tsx:58` / `Explore.tsx:102` put `<h3>`, `<div>` inside `<button>` — invalid HTML (buttons allow only phrasing content) and it breaks the h3 outline for some AT. Resolved by F-06's anchor conversion; drop the now-redundant `aria-label="Open …"` (the h3 becomes the name).

### F-08 · P2 · No skip-to-content link
Keyboard users must tab through brand + 4 nav links + hamburger on every page. Add in `App.tsx` shell (first focusable element):

```tsx
<a className="skip-link" href="#main">Skip to main content</a>
<main id="main" style={{ flex: 1 }}>…</main>
```

```css
.skip-link { position: fixed; top: -48px; left: 12px; z-index: 210; padding: 10px 16px;
  background: var(--color-primary); color: var(--color-primary-foreground); border-radius: 0 0 10px 10px;
  transition: top .15s ease; }
.skip-link:focus-visible { top: 0; box-shadow: var(--ring); }
```

(`z-index: 210` sits above the toast zone 200 so it's visible on any screen.)

### F-09 · P2 · Day-collapse button lacks `aria-expanded`
`TripWorkspace.tsx:691-693` encodes state in the label text ("Expand Day 3"). Prefer the standard state attribute (keeps the name stable):

```tsx
<button className="day-collapse" onClick={toggleCollapsed}
  aria-expanded={!collapsed} aria-controls={`day-body-${day.index}`}
  aria-label={`Day ${day.index + 1} stops`}>
```
with `id={`day-body-${day.index}`}` on the collapsible body div. **Effort:** S.

### F-10 · P2 · Hamburger menu & notifications popover: no Escape, no `aria-controls`
`App.tsx:118-135` (hamburger + mobile sheet) and `:138-190` (notifs) close on outside click only — keyboard users can't dismiss with Escape, and the buttons don't point at what they open.
**Fix:** extend the existing `useClickOutside` cleanup with a key handler, and wire ids:

```tsx
useEffect(() => {
  if (!menuOpen) return
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [menuOpen])   // same for notifOpen

<button className="hamburger" aria-label="Menu" aria-expanded={mobileNav} aria-controls="mobile-menu" …>
<div id="mobile-menu" className="mobile-menu">…</div>
```

### F-11 · P2 · `Avatar` `<img>` without intrinsic dimensions
`src/components/ui.tsx:8` — CSS sizes it, but explicit width/height prevent a layout shift while the avatar loads:

```tsx
<img className={cls} src={user.profile.avatarUrl} alt={user.profile.name}
  width={size === 'lg' ? 56 : 32} height={size === 'lg' ? 56 : 32} />
```
(align the numbers with the `.avatar`/`.avatar.lg` CSS sizes).

## 2. Focus states

### F-12 · P1 · The `--ring` focus treatment covers only 5 selectors
`styles.css:1234-1239` applies the token ring to `.input/.select/.textarea/.btn/.icon-btn`. Every other interactive control still shows the browser default outline — visible, but inconsistent with the documented state matrix in `../DESIGN_TOKENS.md`, and any future `outline: none` added to them would silently break keyboard focus. Extend the shared rule (no per-selector work needed):

```css
/* smooth focus visibility for keyboard users */
.input:focus-visible, .select:focus-visible, .textarea:focus-visible,
.btn:focus-visible, .icon-btn:focus-visible,
.nav-link:focus-visible, .tab-btn:focus-visible, .brand:focus-visible,
.day-collapse:focus-visible, .move-btn:focus-visible, .vote-btn:focus-visible,
.chip-btn:focus-visible, .clickable-chip:focus-visible, .toast-action:focus-visible,
.map-day-chip:focus-visible, .map-idea-chip:focus-visible, .map-legend-toggle:focus-visible,
.map-expand-chip:focus-visible, .loc-option:focus-visible, .ai-fab:focus-visible,
.trip-card-hit:focus-visible, .skip-link:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
```

Keep `.trip-card-hit`'s existing ring (`styles.css:958`) — it just folds into this list. For the map pins (`.yf-map-pin`, HTML buttons inside the canvas) add `outline-offset: 2px` so the ring stays visible over map tiles.
**Effort:** S. **Verify:** tab through the top nav, workspace tabs, timeline cards, map chips — every stop shows the same teal ring.

## 3. Forms

### F-13 · P1 · Auth form missing `autocomplete`, `name`, spellcheck hints
`src/pages/Auth.tsx:68-73`. Password managers can't offer autofill, and email fields get spellcheck squiggles. Also the login/signup mode toggle should stay a URL concern (it already is — `mode=signup` — good).
**Fix:**

```tsx
<Field label="Your name">
  <input className="input" name="name" autoComplete="name" value={name} onChange={…} placeholder="e.g. Meera Nair" />
</Field>
<Field label="Email">
  <input className="input" type="email" name="email" autoComplete="email" spellCheck={false}
    value={email} onChange={…} placeholder="you@example.com" />
</Field>
<Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
  <input className="input" type="password" name="password"
    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
    value={password} onChange={…} placeholder="••••••••" />
</Field>
```

**Effort:** S. (Login UX is the single highest-value form in the app — this is cheap and invisible when done right.)

### F-14 · P2 · Profile form: same hygiene + correct `type` for links
`src/pages/Profile.tsx:44-47,89-90`: display name → `autoComplete="name"`, home city → `autoComplete="address-level2"`, social links → `type="url"` + `inputMode="url"` so mobile keyboards show the URL row. Trip name/destination fields in `CreateTrip.tsx` are *not* personal data — set `autoComplete="off"` there to stop password managers guessing.

### F-15 · P1 · Validation never moves focus and doesn't mark the field
`CreateTrip.tsx:71-84` and `StopEditor.tsx` build an `errs` map and render messages inline (good), but on submit the user must hunt for what failed, and fields don't carry `aria-invalid`.
**Fix (pattern for both forms):**

```tsx
const fieldRefs = useRef<Record<string, HTMLElement | null>>({})

function submit(e: React.FormEvent) {
  e.preventDefault()
  const next: Record<string, string> = { …existing checks… }
  setErrs(next)
  const first = Object.keys(next)[0]
  if (first) { fieldRefs.current[first]?.focus(); return }
  …proceed…
}

// per field — StoreEditor/CreateTrip only need the ref + aria attrs
<input ref={el => (fieldRefs.current.name = el)} aria-invalid={!!errs.name} aria-describedby={errs.name ? 'err-name' : undefined} … />
```

`Field`'s F-01 rewrite already supplies `role="alert"` on the error span so the message is announced the moment it appears.

### F-16 · P1 · Pending impact change is silently discarded on navigation/reload
`TripWorkspace.tsx:67-68` holds a proposed plan in `pending` until "Keep change" / "Remove change". A refresh, a hash edit, or the browser Back button throws it away with no warning — the user loses the preview they were studying. `App.tsx:32-36`'s `hashchange` handler even resets scroll first.
**Fix (two layers):**

```tsx
// TripWorkspace — hard guard: reload / tab close
useEffect(() => {
  if (!pending) return
  const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => window.removeEventListener('beforeunload', onBeforeUnload)
}, [pending])

// App shell — soft guard: in-app hash navigation (optional, keep minimal)
const guardedNav = (to: string) => {
  if (pendingChangeActiveRef.current && !window.confirm('Discard the unapplied change?')) return
  location.hash = to
}
```

If the soft guard feels heavy, the `beforeunload` layer alone already covers the common accident (F5 / closing the tab). **Effort:** S–M.

## 4. Animation & motion

### F-17 · P1 · `prefers-reduced-motion` guards exactly one animation
`styles.css:1269-1271` disables only the map idea-pin pulse. Still running for reduced-motion users: modal/toast/menu `fadeIn`+`slideUp` (`styles.css:597-599,603`, `.557`), `popIn` (`:558`), typing dots (`AiDrawer`), spinner rotation, map-pin hover transform (`:996,999-1005`), and JS `scrollIntoView({ behavior: 'smooth' })` (`TripWorkspace.tsx:79`). None are vestibular-trigger-level (no large parallax), but the standard is to honour the query globally.
**Fix (CSS first):**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
  /* keep the idea-pin visible but static (it already keeps its dashed gold style) */
  .yf-map-pin-idea { animation: none; }
}
```

**and JS:**

```ts
// lib/motion.ts — tiny helper used by scrollToDay
export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// TripWorkspace.tsx:79
el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
```

Animations remain interruptible (CSS-only), and `transform`/`opacity`-only rule is already respected repo-wide. **Effort:** S.

## 5. Typography

### F-18 · P2 · No `text-wrap: balance` on display headings
Long hero/headline strings widow awkwardly at tablet widths (`.hero h1`, `.section-title`, card `h3`). One rule, no risk:

```css
h1, h2, .section-title { text-wrap: balance; }
.card h3, .step-card h3 { text-wrap: pretty; }
```

### F-19 · P2 · Tabular numerals missing on comparison/figure contexts
`tabular-nums` is already correct on `.tl-time` (`styles.css:795`) and the map chip counts, but figures elsewhere jitter as values tick: `.stat-value` (Overview/Budget tiles), `.impact-cell .v` (`:569`), `.vote-count` (`:808`), `.budget-bar-row b`, `.compare-table td.num`, `.weather-temp`. One rule:

```css
.stat-value, .impact-cell .v, .vote-count, .budget-bar-row b,
.compare-table .num, .weather-temp, .tps-stat b { font-variant-numeric: tabular-nums; }
```

## 6. Content handling

### F-20 · P2 · Card titles have no upper bound
`.itin-body h3` (TripsList `:61`, Explore `:112`) wraps indefinitely — a 90-character trip name produces a tall card that misaligns the grid. Descriptions already clamp (`ClampedText`, `.poi-desc`); extend the pattern:

```css
.itin-body h3 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
```

## 7. Navigation & state (URL)

### F-21 · P1 · Workspace tab state is invisible to the URL
`TripWorkspace.tsx:56` — `useState<TabKey>('overview')`. Refreshing while on Budget snaps back to Overview; there is no way to share "look at the Budget tab" or bookmark the Share tab.
**Fix:** make the tab a route segment — `#/trip/:id/budget` (default = no segment):

```tsx
// App.tsx route parsing (parts already split on '/'): pass the segment down
case 'trip': page = <TripWorkspace tripId={parts[2]!} initialTab={parts[3] as TabKey | undefined} … />

// TripWorkspace
const [tab, setTabState] = useState<TabKey>(sanitizeTab(initialTab))
function setTab(t: TabKey) {
  setTabState(t)
  const seg = location.hash.split('/')
  seg[3] = t === 'overview' ? '' : t
  history.replaceState(null, '', seg.filter((s, i) => i !== 3 || s).join('/'))
}
```

`replaceState` (not `location.hash =`) avoids double history entries and the App shell's scroll-reset; browser Back still leaves the trip rather than cycling tabs — correct for a view preference. Sanitise the incoming segment against `TABS` so junk falls back to Overview.

### F-22 · P1 · Explore filters are in-memory only — and the sort is dead code
`Explore.tsx:11-15` holds `q / style / maxBudget / duration` in `useState`; `sortKey` (`:11,37-44`) has **no UI control at all** — every user silently gets "popular".
**Fix:** read initial values from the hash query, write them back on change, and surface the sort:

```tsx
// hash shape: #/explore?q=goa&style=family&max=20000&dur=short&sort=budget-asc
const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
const [q, setQ] = useState(params.get('q') ?? '')
…
function syncUrl(next: Partial<Record<'q'|'style'|'max'|'dur'|'sort', string>>) {
  const p = new URLSearchParams({ q, style, max: String(maxBudget), dur: duration, sort: sortKey, …next })
  for (const [k, v] of [...p]) if (!v || v === 'all' || v === '0') p.delete(k)
  history.replaceState(null, '', `#/explore${p.size ? '?' + p : ''}`)
}
```

plus a `<select className="select" aria-label="Sort by">` wired to `sortKey` (the comparator switch at `:37-44` already implements all four orders). Deep-linkable filters + one feature actually completed. **Effort:** M.

## 8. Touch & interaction

### F-23 · P1 · No `touch-action: manipulation` anywhere
Double-tap-to-zoom latency applies to every button on mobile (vote buttons and map chips are tap-rapid targets). Add:

```css
.btn, .icon-btn, .vote-btn, .move-btn, .chip-btn, .clickable-chip,
.map-day-chip, .map-idea-chip, .map-legend-toggle, .tab-btn, .nav-link,
.trip-card-hit, .day-collapse, .ai-fab, .toast-action { touch-action: manipulation; }
```

(Do **not** set `touch-action: none` — the timeline relies on native scrolling + the long-press DnD engine in `lib/touchDnd.ts`.)

### F-24 · P1 · No `overscroll-behavior: contain` on scrollable overlays
`.modal` (`styles.css:600-604`), `.ai-drawer` (`:840`), `.mobile-menu` (`:1109`), `.loc-dropdown` (`:1198`), and `.map-shell--expanded` (`:775-779`) all scroll while the page scrolls behind them — at the end of the overlay the *background* starts rubber-banding on iOS/Android.

```css
.modal, .ai-drawer, .mobile-menu, .loc-dropdown, .map-shell--expanded { overscroll-behavior: contain; }
```

### F-25 · P2 · Tap highlight left to the UA default
Grey flashes on every tap (jarring against the teal/saffron palette). Suppress and rely on the existing `:active` states:

```css
html { -webkit-tap-highlight-color: transparent; }
```

## 9. Safe areas & layout

### F-26 · P1 · `env(safe-area-inset-*)` is used nowhere
On notched iPhones the fixed layers visually collide with the home indicator: `.toast-zone` (`styles.css:610`, `bottom: 18px`), the mobile bottom-sheet `.modal` (`:1230`), `.impact-sheet`, `.ai-drawer` (`:840`), `.mobile-menu` (`:1109`).
**Fix:**

```css
.toast-zone { bottom: max(18px, env(safe-area-inset-bottom)); }
.modal { padding-bottom: max(22px, env(safe-area-inset-bottom)); }
.impact-sheet { padding-bottom: env(safe-area-inset-bottom); }
.ai-drawer, .mobile-menu { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
```

### F-27 · P2 · No scroll padding under the sticky nav
`scrollToDay` uses `block: 'center'` (safe), but hash-anchor jumps and future scroll helpers land beneath the 62px `.topnav`. One rule future-proofs it:

```css
html { scroll-padding-top: calc(var(--nav-h) + 12px); }
.day-section { scroll-margin-top: calc(var(--nav-h) + 12px); }
```

## 10. Dark mode & theming

### F-28 · P0 · No `color-scheme`, so native UI renders light inside the dark theme
The dark theme re-skins tokens (`styles.css:87-130`) but never tells the UA: scrollbars, `<select>` popup lists, date/time pickers, `autofill` and form-control chrome all render **light** while the page is dark. This is the most visible dark-mode defect on desktop and in iOS date pickers on the Timeline.
**Fix:**

```css
:root { color-scheme: light; }
[data-theme='dark'] { color-scheme: dark; }
```

Also verify `.select`/`.input` carry explicit `background-color` + `color` in dark theme (Windows fires dark UA styles at unstyled controls) — extend the `:root`/`[data-theme='dark']` blocks if any control relies on UA paint.

### F-29 · P2 · No `<meta name="theme-color">`
`index.html:3-11` — the browser chrome (address bar) never matches the page, which is jarring when toggling themes.
**Fix:** declare both up front (the media attributes pick automatically) and keep them in sync on toggle:

```html
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FAF7F2">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0C1420">
```

```tsx
// App.tsx effect (lines 43-46) — keep the meta in step with the explicit toggle
document.querySelectorAll('meta[name="theme-color"]').forEach(m =>
  m.setAttribute('content', dark ? '#0C1420' : '#FAF7F2'))
```

### F-30 · P2 · Native controls don't pick up the brand accent
The detour-scope range slider (`TripWorkspace.tsx:1588-1598`), checkboxes and radios render UA-blue/grey. One line:

```css
:root { accent-color: var(--teal-500); }
[data-theme='dark'] { accent-color: var(--teal-500); }
```

## 11. Performance

✅ **Pass, with one optional note.** MapLibre is already a lazy chunk (`TripWorkspace.tsx:27-28`); fonts use `preconnect` + `display=swap` (`index.html:9-11`); list sizes are small (no virtualization needed at current data volumes); no layout reads in render paths (`scrollToDay`/`ClampedText` measure inside effects/handlers only).
**Optional (P3):** the Google Fonts CSS is still render-blocking; self-hosting the two families (woff2, subset latin) with `<link rel="preload" as="font">` would shave first paint — worth it only if Lighthouse flags it.

## 12. Locale & i18n

### F-31 · P2 · Currency formatting bypasses the engine's formatter
`Explore.tsx:116` hardcodes `p.estimatedBudgetPerPersonInr.toLocaleString('en-IN')` while every other surface goes through `formatInr` (`lib/engine.ts`) — two different money styles on one card (₹14,250 vs ₹14.3k vs formatInr's grouping). Route it through `formatInr` (or a `formatShort` shared with `TripsList.tsx:102-106`, which has its own duplicate). Dates already flow through the app's own formatters + `useTimeFormat` — pass.

## 13. Content & copy

### F-32 · P2 · Straight apostrophes/quotes in a handful of strings
The repo mostly uses `…` and curly quotes correctly (`'Loading…'`, `'Searching the route…'`, `“...”` in `ui.tsx`, `AiDrawer.tsx`). Stragglers spotted: `Landing.tsx:53` (`doesn't`), `TripsList.tsx:30,91` (`you're`, `You'll`), `Profile.tsx:53` (`what kind of trip`). Sweep JSX text nodes for `'` → `’` (skip code identifiers) — mechanical, grep `\\w'\\w` in `src/**/*.tsx`. Title Case on buttons is **not** consistently used in this app by design (sentence case everywhere) — leave as is; consistency beats the guideline here.

## 14. Hydration safety — ✅ pass
CSR-only app (`ReactDOM.createRoot`, `main.tsx`) — no SSR hydration surface. `localStorage` reads are guarded in `uiPrefs.ts`/`timefmt.ts` for private-mode Safari. No action.

## 15. Hover & interactive states — ✅ pass (1 note)
All primary controls have hover feedback and hover > default contrast: `.nav-link:hover`, `.btn-*:hover` with dedicated hover tokens (`styles.css:212-224`), `.icon-btn:hover` (`:232`), `.tab-btn:hover` (`:587`), `.vote-btn:hover` (`:806`), `.map-legend-toggle` uses translucent white/dark variants (`:766-769`). Note: `.day-collapse` and `.move-btn` have hover styles but verify `.move-btn:disabled` dims (matches `.btn:disabled` pattern at `:210`).

## 16. Anti-pattern checklist — 14/16 clean

| Guideline anti-pattern | Verdict |
|---|---|
| `transition: all` | ✅ none (grep) |
| `outline: none` without focus replacement | ✅ all three occurrences paired with `--ring` (`styles.css:211,958,1237`) |
| `user-scalable=no` / `maximum-scale=1` | ✅ viewport is clean (`index.html:5`) |
| `onPaste` preventDefault | ✅ none |
| `<div>/<span>` with click handlers | ✅ none — `App.tsx:184` etc. are real `<button>`s |
| `alert()/confirm()` for destructive actions | ✅ `ConfirmDialog` + `undoToast` everywhere |
| Icon-only buttons without `aria-label` | ⚠️ 5 flagged (F-02, F-05) |
| Form inputs without labels | ❌ systemic — F-01 |
| Images without dimensions | ⚠️ avatars only (F-11) |
| Large unvirtualized lists | ✅ lists ≤ ~20 items |
| `autoFocus` without justification | ✅ two uses, both inline-edit/desktop (acceptable; keep off mobile) |
| Hardcoded date formats | ✅ `formatHM`/`Intl` behind `timefmt.ts` |
| Gesture-only actions | ✅ every DnD surface has buttons (`moveUp`/`moveDown`) + touch long-press engine |
| Animated GIFs | ✅ none |
| `beforeunload` unsaved-changes guard | ❌ F-16 |
| URL reflects state | ❌ F-21, F-22 |

## 17. Fix roadmap

Six independent batches, ordered so shared primitives land first and CSS-only batches are verified with the full build gate:

| # | Batch | Findings | Files | Est. |
|---|---|---|---|---|
| 1 | **Theming & touch CSS** | F-23, F-24, F-25, F-26, F-27, F-28, F-29, F-30 + F-18/F-19/F-20 rules | `styles.css`, `index.html`, `App.tsx` (meta sync) | 2 h |
| 2 | **Shared primitives** | F-01, F-03, F-11 | `components/ui.tsx`, `components/LocationInput.tsx` | 2 h |
| 3 | **Focus ring + reduced motion** | F-12, F-17 (+ `lib/motion.ts`) | `styles.css`, `TripWorkspace.tsx` | 1 h |
| 4 | **A11y attributes & navigation semantics** | F-02, F-05, F-06, F-07, F-08, F-09, F-10 | `App.tsx`, `Landing.tsx`, `TripsList.tsx`, `Explore.tsx`, `TripWorkspace.tsx`, `TripMap.tsx` | 3 h |
| 5 | **Form hygiene** | F-13, F-14, F-15, F-16 | `Auth.tsx`, `Profile.tsx`, `CreateTrip.tsx`, `StopEditor.tsx`, `TripWorkspace.tsx` | 3 h |
| 6 | **URL state + copy** | F-21, F-22, F-31, F-32 | `App.tsx`, `TripWorkspace.tsx`, `Explore.tsx`, `TripsList.tsx` | 3 h |

Batch 1 + 3 are pure CSS/one-liners (highest fix-per-risk ratio). Batch 6 contains the only behavioural refactors (tab + filter URL sync) — do them last and manually regression-test tab switching, Back, and refresh.

## 18. Verification plan

1. `npm run verify` after **every batch** — remember CSS syntax errors are invisible to `tsc` + vitest; the `vite build` step is the only gate that catches them (repo lesson #14, `../AGENTS.md` §4).
2. **Keyboard walkthrough** (no mouse): Tab from URL bar → skip link (F-08) → nav → workspace tabs → timeline stop actions; Enter/Space activate; Escape closes menu/notifs/modals; focus ring visible everywhere (F-12); ConfirmDialog focus lands on Cancel (F-03).
3. **Screen-reader pass** (NVDA or VoiceOver): every input announces its label (F-01); toasts, AI replies, form errors announced (F-04); day collapse announced with state (F-09).
4. **Dark-mode pass**: scrollbars, `<select>` popups, date pickers all dark (F-28); address bar matches (`F-29`).
5. **Mobile pass** (360 × 800, Chrome device emulation + real iOS if available): no double-tap-zoom delay (F-23), no background scroll chaining in modal/drawer (F-24), toasts/sheets clear the home indicator (F-26), no iOS zoom on input focus (already handled).
6. **Reduced-motion** (DevTools rendering emulation): no modal/toast slide, map pin static (F-17).
7. **URL state**: refresh on `#/trip/:id/budget` restores the Budget tab; Explore filters survive refresh and are shareable (F-21/F-22).

## Appendix · Finding index

| ID | Sev | Summary | Where |
|---|---|---|---|
| F-01 | P0 | Field labels not associated with controls | `ui.tsx:102-116` |
| F-28 | P0 | No `color-scheme` (dark theme) | `styles.css:10,87` |
| F-02 | P1 | Icon buttons `title`-only names | `TripWorkspace.tsx:874-876`, `TripMap.tsx:572-576` |
| F-03 | P1 | ConfirmDialog focuses destructive button | `ui.tsx:49-53,88-98` |
| F-04 | P1 | Missing live regions (AI chat, errors, results) | `AiDrawer.tsx:61`, `Auth.tsx:74` |
| F-05 | P1 | Placeholder-only inputs | `Explore.tsx:67`, `AiDrawer.tsx:82`, `TripWorkspace.tsx:696,1159,1796` |
| F-06 | P1 | Navigation via buttons, not links | `App.tsx:182-190`, `Landing.tsx:19-20`, cards |
| F-12 | P1 | Focus ring missing on 17 interactive selectors | `styles.css:1234-1239` |
| F-13 | P1 | Auth form: no `autocomplete`/`name`/`spellCheck` | `Auth.tsx:68-73` |
| F-15 | P1 | No focus-first-error, no `aria-invalid` | `CreateTrip.tsx:71-84`, `StopEditor.tsx` |
| F-16 | P1 | Pending change lost on nav/reload silently | `TripWorkspace.tsx:67-68` |
| F-17 | P1 | Reduced-motion honours 1 of ~8 animations | `styles.css:1269-1271` |
| F-21 | P1 | Workspace tab not in URL | `TripWorkspace.tsx:56` |
| F-22 | P1 | Explore filters not in URL; sort is dead code | `Explore.tsx:11-15,37-44` |
| F-23 | P1 | No `touch-action: manipulation` | `styles.css` (global) |
| F-24 | P1 | No `overscroll-behavior: contain` on overlays | `styles.css:600,775,840,1109,1198` |
| F-26 | P1 | No safe-area insets on fixed layers | `styles.css:610,840,1109` + sheets |
| F-07 | P2 | `<button>` wrapping block content | `TripsList.tsx:58`, `Explore.tsx:102` |
| F-08 | P2 | No skip link | `App.tsx` |
| F-09 | P2 | Day collapse lacks `aria-expanded` | `TripWorkspace.tsx:691-693` |
| F-10 | P2 | Menu/notifs: no Escape, no `aria-controls` | `App.tsx:118-190` |
| F-11 | P2 | Avatar `<img>` no intrinsic size | `ui.tsx:8` |
| F-14 | P2 | Profile form hygiene, `type="url"` links | `Profile.tsx:44-47,89-90` |
| F-18 | P2 | No `text-wrap: balance` on headings | `styles.css` |
| F-19 | P2 | `tabular-nums` gaps on stat/impact figures | `styles.css:569,808` |
| F-20 | P2 | Card titles unbounded | `TripsList.tsx:61`, `Explore.tsx:112` |
| F-25 | P2 | UA tap-highlight flashes | `styles.css` (global) |
| F-27 | P2 | No `scroll-padding-top` | `styles.css` |
| F-29 | P2 | No `theme-color` meta | `index.html` |
| F-30 | P2 | No `accent-color` | `styles.css` |
| F-31 | P2 | Hardcoded `toLocaleString('en-IN')` | `Explore.tsx:116` |
| F-32 | P2 | Straight apostrophes in copy | `Landing.tsx:53`, `TripsList.tsx:30,91` |
| F-33 | P2 | Glass rules missing `-webkit-backdrop-filter` (Safari: no blur) | `styles.css` — `.modal-overlay`, `.itin-cover .chip`, `.map-legend-toggle/-body`, `.locked-overlay`, `.locked-cta`, `.explore-hero-search` |

*Counts: 33 findings — 2 P0 · 15 P1 · 16 P2. Sections 11, 14, 15 record the passes.*

### F-33 · P2 · Six glass rules kept only the standard `backdrop-filter`

**Found** during the Sep 2 post-CTI design-language sweep (after the minifier
blur saga, see AGENTS.md §4). The 7 original paired rules were fixed to author
`-webkit-` first; these 6 single-declaration rules were missed because they
never had a `-webkit-` twin to merge with — Lightning CSS leaves them alone, so
Chromium is fine, but **Safari renders them blur-less** (same class of bug the
minifier saga exposed, opposite direction).

**Fix (applied in the same commit as this entry):** author the `-webkit-` form
first, standard last, per the AGENTS.md §4 rule:

```css
-webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
```
