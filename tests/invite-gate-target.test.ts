// ============ #804 round 10 B4 — a join belongs to ONE link target ============
//
// The gate used to keep its join state in component refs, and changing the link
// target reused the component. The old join's completion could then finish the
// NEW target's gate and navigate to a trip that was never admitted.
//
// These tests mount the REAL InviteGate function from App.tsx with synthetic
// hooks and effects, change its link target while a join is in flight, and
// resolve the old join afterwards. The harness is the same extraction the gate
// probe uses: actual source, synthetic React.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import * as gate from '../src/lib/inviteGateStates'
import {
  alreadyMemberCopy, expiredInviteCopy, inviteConfirmCopy, inviteReadOnlyFacts,
  invitesStopCount, paidGuidePriceFor, recipientInviteCopy,
} from '../src/lib/inviteLandingCopy'
import { inviteRoute, normalizeInviteCode } from '../src/lib/inviteCode'

const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', APP, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'InviteGate')
if (!node) throw new Error('InviteGate is missing from App.tsx')
const JS = ts.transpileModule(node.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText

const TRIP_A = '11111111-1111-4111-8111-111111111111'
const TRIP_B = '22222222-2222-4222-8222-222222222222'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

async function drain() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

function trip(id: string) {
  return {
    id, name: id === TRIP_A ? 'First' : 'Second', inviteCode: id === TRIP_A ? 'CODE' : 'SECOND',
    members: [] as Array<{ userId: string; role: string; joinedAt: number }>,
    days: [], destinations: [], expenses: [], startDate: '2026-10-01', endDate: '2026-10-02',
  }
}

interface Harness {
  props: { codeOrTripId: string; onNavigate: (r: string) => void }
  events: unknown[][]
  rerender: () => void
  settle: () => Promise<void>
  setUser: (id: string | null) => void
  stateBlock: () => { props: { title?: string; body?: string } } | undefined
  header: () => { props: { headline?: { lead?: string }; lede?: unknown } } | undefined
  /** Press the confirm screen's primary action; the gate joins only after it. */
  confirm: () => void
  retry: () => void
}

function mountGate(join: (tripId: string) => Promise<gate.JoinResult>, overrides: Record<string, unknown> = {}): Harness {
  const slots: unknown[] = []
  const deps: Array<unknown[] | undefined> = []
  const listeners: Array<Array<() => void>> = []
  const cleanups: Array<(() => void) | undefined> = []
  const events: unknown[][] = []
  const effects: Array<{ i: number; fn: () => (() => void) | undefined }> = []
  let index = 0
  let dirty = true
  let tree: unknown

  const defaults: Record<string, unknown> = {
    React: { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    StateBlock: 'StateBlock', Link2: 'Link2', Mail: 'Mail', ProfileLookupNotice: 'ProfileLookupNotice',
    // The invite screen's own pieces. The copy builders are the real modules:
    // this file measures the gate's machine, not its words.
    PageHeader: 'PageHeader', appLink: () => ({}),
    usePublished: () => [],
    recipientInviteCopy, inviteConfirmCopy, expiredInviteCopy, alreadyMemberCopy,
    inviteReadOnlyFacts, invitesStopCount, paidGuidePriceFor,
    inviteRoute, normalizeInviteCode,
    useDb: () => ({ sessionUserId: (context.me as { id?: string } | null)?.id ?? null, sliceReads: {} }),
    currentUser: () => context.me,
    profileLookupState: () => null,
    needsProfileLookup: () => false,
    UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    // The real state module: the same gateMachine, joinMachine and owner helpers.
    ...gate,
    tripById: () => context.cached,
    // #1019 — the lookup answers an InviteLookup, not a bare trip.
    fetchTripByInviteCode: async (code: string) => {
      events.push(['resolve', code])
      return { kind: 'found' as const, trip: code === 'SECOND' ? trip(TRIP_B) : trip(TRIP_A) }
    },
    readSharedTrip: async (id: string) => ({ kind: 'found', trip: trip(id) }),
    viewerIsMemberOf: async () => false,
    ...overrides,
    joinViaInvite: (tripId: string) => {
      events.push(['join', tripId])
      return join(tripId)
    },
    reloadJoinedTrip: async () => 'joined-unloaded',
    toast: (...args: unknown[]) => events.push(['toast', ...args]),
    me: { id: 'A' },
    identityGen: 1,
    useIdentityGeneration: () => context.identityGen,
    console: { error: () => {} },
    useState(initial: unknown) {
      const i = index++
      // React calls a function initializer once; the gate uses one for its
      // per-mount id, so the shim must do the same.
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [slots[i], (value: unknown) => {
        const next = typeof value === 'function' ? (value as (v: unknown) => unknown)(slots[i]) : value
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true }
      }]
    },
    useRef(initial: unknown) {
      const i = index++
      return slots[i] ?? (slots[i] = { current: initial })
    },
    useCallback(fn: unknown, values: unknown[]) {
      const i = index++
      const previous = deps[i]
      if (!previous || values.some((v, k) => !Object.is(v, previous[k]))) { slots[i] = fn; deps[i] = values }
      return slots[i]
    },
    useEffect(fn: () => (() => void) | undefined, values?: unknown[]) {
      const i = index++
      const previous = deps[i]
      if (!values || !previous || values.some((v, k) => !Object.is(v, previous[k]))) { deps[i] = values; effects.push({ i, fn }) }
    },
    useSyncExternalStore(subscribe: (fn: () => void) => () => void, get: () => unknown) {
      const i = index++
      if (!listeners[i]) {
        listeners[i] = []
        subscribe(() => { slots[i] = get(); dirty = true })
      }
      slots[i] = get()
      return slots[i]
    },
  }
  const context: Record<string, unknown> = { ...defaults, ...overrides }
  context.me = { id: 'A' }
  context.sessionUserId = 'A'
  const vm = createContext(context)
  runInContext(JS, vm)

  const props = { codeOrTripId: 'CODE', onNavigate: (r: string) => events.push(['navigate', r]) }
  const invoke = vm.InviteGate as (p: typeof props) => unknown
  function render() {
    if (!dirty) return
    dirty = false
    index = 0
    tree = invoke(props)
    const pending = effects.splice(0)
    for (const { i, fn } of pending) { cleanups[i]?.(); cleanups[i] = fn() }
  }
  async function settle() {
    for (let n = 0; n < 40; n += 1) { render(); await drain(); if (!dirty) break }
  }
  function walk(node: unknown, pred: (n: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
    if (!node || typeof node !== 'object') return []
    const n = node as Record<string, unknown>
    return [...(pred(n) ? [n] : []), ...(((n.children as unknown[]) ?? []).flatMap(c => walk(c, pred))), ...walk(n.props && (n.props as Record<string, unknown>).actions, pred)]
  }
  const stateBlock = () => walk(tree, n => n.type === 'StateBlock')[0] as { props: { title?: string; body?: string } } | undefined
  const header = () => walk(tree, n => n.type === 'PageHeader')[0] as
    { props: { headline?: { lead?: string }; lede?: unknown } } | undefined
  /** Press the confirm screen's primary action. The gate joins only after it. */
  const confirm = () => {
    const button = walk(tree, n => n.type === 'button' && Array.isArray(n.children) && n.children.includes('Join the trip'))[0]
    const onClick = (button?.props as { onClick?: unknown } | undefined)?.onClick
    if (typeof onClick !== 'function') throw new Error('the confirm button is missing')
    onClick()
  }
  const retry = () => {
    const button = walk(tree, n => n.type === 'button' && Array.isArray(n.children) && n.children.includes('Try again'))[0]
    const onClick = (button?.props as { onClick?: unknown } | undefined)?.onClick
    if (typeof onClick !== 'function') throw new Error('Try again is missing')
    onClick()
  }
  return {
    props, events, rerender: () => { dirty = true }, settle, setUser: id => { context.me = id ? { id } : null; context.identityGen = Number(context.identityGen ?? 0) + 1; dirty = true },
    stateBlock, header, confirm, retry,
  }
}

describe('the harness itself: one joined answer opens the trip', () => {
  it('a single target whose join answers "joined" navigates once', async () => {
    const h = mountGate(async () => 'joined')
    await h.settle()
    h.confirm()
    await h.settle()
    expect(h.events.filter(e => e[0] === 'join')).toHaveLength(1)
    expect(h.events.filter(e => e[0] === 'navigate')).toEqual([['navigate', `/trip/${TRIP_A}`]])
  })
})

describe('B4 — a target change retires the old join before it can finish the new gate', () => {
  it('the OLD join answer cannot navigate to the newly resolved target', async () => {
    // A control first: on a single target, this join DOES open the trip, so the
    // case below measures the target change and nothing else.
    const control = mountGate(async () => 'joined')
    await control.settle()
    control.confirm()
    await control.settle()
    expect(control.events.filter(e => e[0] === 'navigate'), 'a join on one target opens it').toEqual([
      ['navigate', `/trip/${TRIP_A}`],
    ])

    const oldJoin = deferred<gate.JoinResult>()
    const newJoin = deferred<gate.JoinResult>()
    let calls = 0
    const h = mountGate(() => { calls += 1; return calls === 1 ? oldJoin.promise : newJoin.promise })
    await h.settle()
    h.confirm()
    await h.settle()
    expect(h.events.filter(e => e[0] === 'join')).toHaveLength(1)

    // The link moves to a second code while the first join is still in flight.
    h.props.codeOrTripId = 'SECOND'
    h.rerender()
    await h.settle()
    h.confirm()
    await h.settle()

    // The old join answers "joined" BEFORE the new target's own join answers.
    // That answer belongs to the old try, so it navigates nowhere.
    const before = h.events.filter(e => e[0] === 'navigate').length
    oldJoin.resolve('joined')
    await h.settle()
    expect(h.events.filter(e => e[0] === 'navigate').length, 'the old answer navigates nowhere').toBe(before)

    // The new target's own answer is the one that opens it.
    newJoin.resolve('joined')
    await h.settle()
    expect(h.events.filter(e => e[0] === 'navigate')).toEqual([['navigate', `/trip/${TRIP_B}`]])
  })

  it('the NEW target starts its own join instead of stalling on the old try', async () => {
    // The FIRST target's join answers "joined" before the link moves, which is
    // the earlier BASE risk: without a retirement the old claim still sits in the
    // machine. The new target must still start its OWN try, and only that try may
    // open the trip.
    const second = deferred<gate.JoinResult>()
    let calls = 0
    const h = mountGate(async () => {
      calls += 1
      if (calls === 1) return 'joined'
      return second.promise
    })
    await h.settle()
    h.confirm()
    await h.settle()

    h.props.codeOrTripId = 'SECOND'
    h.rerender()
    await h.settle()
    h.confirm()
    await h.settle()
    const joins = h.events.filter(e => e[0] === 'join')
    expect(joins.length, 'the new target begins its own try').toBe(2)
    expect(joins[1][1]).toBe(TRIP_B)

    second.resolve('joined')
    await h.settle()
    const navigations = h.events.filter(e => e[0] === 'navigate')
    expect(navigations[navigations.length - 1]).toEqual(['navigate', `/trip/${TRIP_B}`])
  })

  it('a UUID target change ignores the old membership answer', async () => {
    // A trip-id link never joins; it asks whether the viewer is a member. The
    // answer for the FIRST uuid arrives after the link moved to the SECOND uuid,
    // and it must not open either trip.
    const answer = deferred<boolean>()
    const h = mountGate(async () => 'failed', { viewerIsMemberOf: () => answer.promise })
    h.props.codeOrTripId = TRIP_A
    await h.settle()
    h.props.codeOrTripId = TRIP_B
    h.rerender()
    await h.settle()
    answer.resolve(true)
    await h.settle()
    const navigations = h.events.filter(e => e[0] === 'navigate')
    expect(navigations.filter(e => e[1] === `/trip/${TRIP_A}`), 'the old membership answer opens nothing').toHaveLength(0)
  })

  it('an account generation change retires the old try before the replacement settles', async () => {
    const oldJoin = deferred<gate.JoinResult>()
    let calls = 0
    const h = mountGate(() => (++calls === 1 ? oldJoin.promise : Promise.resolve('joined')))
    await h.settle()
    h.confirm()
    await h.settle()
    h.setUser('B')
    await h.settle()
    oldJoin.resolve('joined')
    await h.settle()
    expect(calls).toBe(2)
    expect(h.events.filter(e => e[0] === 'navigate')).toEqual([['navigate', `/trip/${TRIP_A}`]])
  })
})

describe('S1 — an unmounted gate relinquishes its registry state', () => {
  it('disposal retires its owner and blocks stale events for that mount', () => {
    const mountId = gate.nextAttemptId()
    const target = `DISPOSE-${mountId}`
    const owner = gate.createAttemptOwner(target)
    gate.gateMachine(target, mountId)
    gate.setGateOwner(target, owner, mountId)
    gate.dispatchGateEvent(target, { type: 'begin', userId: 'A', gen: 1, member: false, tryId: owner.id }, mountId)
    gate.disposeGateMount(mountId)
    expect(owner.retired).toBe(true)
    expect(gate.gateMachineState(target)).toBeUndefined()
    expect(gate.dispatchGateEvent(target, { type: 'join-settled', userId: 'A', gen: 1, tryId: owner.id, result: 'joined' }, mountId).action.type).toBe('none')
  })
})

describe('#1019 — the lookup answer picks the screen', () => {
  it('a dead code renders the dead-link copy, word for word', async () => {
    const h = mountGate(async () => 'not-member', { fetchTripByInviteCode: async () => ({ kind: 'dead' }) })
    await h.settle()
    expect(h.header()?.props.headline?.lead).toBe('This invite link has expired.')
    expect(h.header()?.props.lede).toBe('Links can be reset by whoever owns the trip. Ask whoever shared it for a fresh one, or enter the code they shared.')
  })

  it('a failed read renders the retry screen, never the dead-link copy', async () => {
    const next = deferred<{ kind: 'dead' }>()
    let reads = 0
    const h = mountGate(async () => 'not-member', {
      fetchTripByInviteCode: async () => ++reads === 1 ? { kind: 'failed' } : next.promise,
    })
    await h.settle()
    expect(h.stateBlock()?.props.title).toBe('This invite didn’t load')
    h.retry()
    await h.settle()
    expect(h.stateBlock()?.props.title).toBe('Opening invite…')
    next.resolve({ kind: 'dead' })
    await h.settle()
    expect(h.header()?.props.headline?.lead).toBe('This invite link has expired.')
    expect(h.events).toEqual([])
  })

  it('a new link loads while its own lookup is pending', async () => {
    const next = deferred<{ kind: 'found'; trip: ReturnType<typeof trip> }>()
    const h = mountGate(async () => 'joined', {
      fetchTripByInviteCode: async (code: string) => code === 'CODE' ? { kind: 'dead' } : next.promise,
    })
    await h.settle()
    expect(h.header()?.props.headline?.lead).toBe('This invite link has expired.')
    h.props.codeOrTripId = 'SECOND'
    h.rerender()
    await h.settle()
    expect(h.stateBlock()?.props.title).toBe('Opening invite…')
    next.resolve({ kind: 'found', trip: trip(TRIP_B) })
    await h.settle()
    // The new link resolves to its own confirm screen; nothing joins by itself.
    expect(h.header()?.props.headline?.lead).toBe('Join Second?')
    expect(h.events.filter(e => e[0] === 'navigate')).toEqual([])
  })

  it('a new account waits for its own lookup before joining', async () => {
    const firstJoin = deferred<gate.JoinResult>()
    const next = deferred<{ kind: 'dead' }>()
    let reads = 0
    const h = mountGate(() => firstJoin.promise, {
      fetchTripByInviteCode: async () => ++reads === 1 ? { kind: 'found', trip: trip(TRIP_A) } : next.promise,
    })
    await h.settle()
    h.confirm()
    await h.settle()
    expect(h.events.filter(e => e[0] === 'join')).toHaveLength(1)
    h.setUser('B')
    await h.settle()
    expect(h.events.filter(e => e[0] === 'join')).toHaveLength(1)
    expect(h.stateBlock()?.props.title).toBe('Opening invite…')
    next.resolve({ kind: 'dead' })
    await h.settle()
    expect(h.header()?.props.headline?.lead).toBe('This invite link has expired.')
  })
})

describe('B5 — the real invite screen names each terminal refusal', () => {
  it.each([
    ['not-member', 'This account is not on the trip'],
    ['missing', 'This trip is not available'],
    ['deleted', 'This trip was deleted'],
  ] as const)('%s renders its own status', async (result, title) => {
    const h = mountGate(async () => result)
    await h.settle()
    h.confirm()
    await h.settle()
    expect(h.stateBlock()?.props.title).toBe(title)
    expect(h.events.filter(e => e[0] === 'navigate')).toHaveLength(0)
  })
})
