import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-scan pins for #935: a commenter may send comment and ballot commands,
// and no other command widens.
// The SQL is read as text. Each check also runs against the 20261117 text.
// That text must fail the check. See the negative controls below.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = read('supabase/migrations/20261120_collab_commenter_commands.sql')
const PREVIOUS = read('supabase/migrations/20261117_group_input_phase2.sql')
const POLICIES = read('supabase/migrations/20261116_trip_settings_boundary.sql')
const SCHEMA = read('supabase/schema.sql')

const COMMENTER_KINDS = ['decision.ballot', 'decision.comment', 'suggestion.ballot', 'suggestion.comment']
const EDITOR_ONLY_KINDS = [
  'activity.append',
  'decision.create',
  'decision.option.add',
  'decision.resolve',
  'suggestion.accept',
  'suggestion.create',
  'suggestion.decline',
]
const GATE_LINE = "  if not (public.is_editor(v_trip_id) or (v_kind in ('suggestion.comment','suggestion.ballot','decision.comment','decision.ballot') and public.can_comment(v_trip_id))) then"

/** The text from `create [or replace] function public.NAME(` to its closing `$$;`. */
const functionText = (sql: string, name: string): string => {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`))
  if (start < 0) return ''
  const end = sql.indexOf('$$;', start)
  return end < 0 ? '' : sql.slice(start, end + 3)
}

const submitOf = (sql: string) => functionText(sql, 'submit_collab_command')
const canCommentOf = (sql: string) => functionText(sql, 'can_comment')

/** The one line that holds the role gate, or '' when the function has none. */
const gateLineOf = (fn: string) => fn.split('\n').find(line => line.includes('if not (public.is_editor(v_trip_id)')) ?? ''

/** The kinds the gate admits for a commenter, sorted; null when the gate has no kind list. */
const commenterKindsOf = (fn: string): string[] | null => {
  const match = gateLineOf(fn).match(/v_kind in \(([^)]*)\)/)
  if (!match) return null
  return match[1].split(',').map(kind => kind.trim().replace(/^'|'$/g, '')).sort()
}

/** True when the gate line is exactly the commenter gate the ruling allows. */
const commenterGateOk = (fn: string) => gateLineOf(fn) === GATE_LINE

/** True when v_kind is read exactly once, and before the first role gate of either shape. */
const kindBeforeGateOk = (fn: string) => {
  const assign = "v_kind:=p_command->>'type';"
  const at = fn.indexOf(assign)
  const gate = fn.search(/if not \(?public\.is_editor\(v_trip_id\)/)
  return at >= 0 && gate >= 0 && at < gate && fn.split(assign).length === 2
}

/** True when the role list of can_comment admits owner, editor and commenter, and no viewer. */
const canCommentRolesOk = (fn: string) =>
  fn.includes("m.role in ('owner', 'editor', 'commenter')") && !fn.includes('viewer')

/** True when the table's read policy is member-scoped, not editor-scoped. */
const memberReadOk = (sql: string, table: string) => {
  const pattern = new RegExp(
    `create policy "${table} read" on public\\.${table}\\s+for select to authenticated using\\s*\\(public\\.is_member\\(trip_id\\) or public\\.is_admin\\(\\)\\);`,
  )
  return pattern.test(sql)
}

describe('#935 commenter command gate (migration 20261120)', () => {
  const submit = submitOf(MIGRATION)
  const canComment = canCommentOf(MIGRATION)

  it('the migration defines can_comment and submit_collab_command', () => {
    expect(canComment).not.toBe('')
    expect(submit).not.toBe('')
  })

  it('can_comment admits owner, editor and commenter, and never a viewer', () => {
    expect(canCommentRolesOk(canComment)).toBe(true)
    expect(canComment).toContain('t.owner_id = auth.uid()')
    expect(canComment).toContain('public.is_admin()')
    expect(canComment).toContain('not public.is_disabled()')
    expect(canComment).toContain('language sql')
    expect(canComment).toContain('security definer')
    expect(canComment).toContain('set search_path = public')
  })

  it('can_comment is closed to anon and PUBLIC, and open to authenticated', () => {
    expect(MIGRATION).toContain('revoke all on function public.can_comment(uuid) from public, anon;')
    expect(MIGRATION).toContain('grant execute on function public.can_comment(uuid) to authenticated;')
  })

  it('the role gate admits a commenter only for the four comment and ballot kinds', () => {
    expect(gateLineOf(submit)).toBe(GATE_LINE)
    expect(commenterKindsOf(submit)).toEqual([...COMMENTER_KINDS])
    expect(submit.split('public.can_comment(v_trip_id)').length).toBe(2)
  })

  it('the six editor-only kinds are outside the commenter list', () => {
    const admitted = commenterKindsOf(submit) ?? []
    for (const kind of EDITOR_ONLY_KINDS) expect(admitted).not.toContain(kind)
  })

  it('create, accept, decline, resolve, option.add and activity.append still need is_editor', () => {
    // is_editor appears once in the RPC: in the gate. The editor-only branches
    // stay behind that single check, so no branch gains a commenter path.
    expect(submit.split('public.is_editor(').length).toBe(2)
    for (const kind of EDITOR_ONLY_KINDS) expect(submit).toContain(`'${kind}'`)
  })

  it('v_kind is read once, before the role gate', () => {
    expect(kindBeforeGateOk(submit)).toBe(true)
  })

  it('the function keeps the 20261117 security definer, search path and grants', () => {
    expect(submit).toContain('returns jsonb language plpgsql security definer set search_path = \'\' as $$')
    expect(MIGRATION).toContain('revoke all on function public.submit_collab_command(text,text,jsonb) from public, anon;')
    expect(MIGRATION).toContain('grant execute on function public.submit_collab_command(text,text,jsonb) to authenticated;')
  })
})

describe('#935 schema mirror matches the migration', () => {
  it('schema.sql carries the same submit_collab_command text', () => {
    expect(submitOf(SCHEMA)).not.toBe('')
    expect(submitOf(SCHEMA)).toBe(submitOf(MIGRATION))
  })

  it('schema.sql carries the same can_comment text', () => {
    expect(canCommentOf(SCHEMA)).not.toBe('')
    expect(canCommentOf(SCHEMA)).toBe(canCommentOf(MIGRATION))
  })
})

describe('#935 viewer reads stay member-scoped', () => {
  it.each(['suggestions', 'decisions', 'activity'])('%s read uses is_member, so a viewer can read', table => {
    expect(memberReadOk(POLICIES, table)).toBe(true)
    expect(memberReadOk(SCHEMA, table)).toBe(true)
  })
})

describe('#935 negative controls: the checks fail on the old text', () => {
  const previous = submitOf(PREVIOUS)
  const current = submitOf(MIGRATION)

  it('the 20261117 gate is editor-only, so the commenter gate check rejects it', () => {
    expect(previous).not.toBe('')
    expect(commenterGateOk(previous)).toBe(false)
    expect(commenterGateOk(current)).toBe(true)
  })

  it('the 20261117 function reads v_kind after the gate, so the order check rejects it', () => {
    expect(kindBeforeGateOk(previous)).toBe(false)
    expect(kindBeforeGateOk(current)).toBe(true)
  })

  it('a gate that admits all six editor kinds fails the kind-list check', () => {
    const widened = current.replace(GATE_LINE, GATE_LINE.replace(
      "v_kind in ('suggestion.comment','suggestion.ballot','decision.comment','decision.ballot')",
      "v_kind in ('suggestion.comment','suggestion.ballot','decision.comment','decision.ballot','suggestion.create')",
    ))
    expect(widened).not.toBe(current)
    expect(commenterKindsOf(widened)).not.toEqual([...COMMENTER_KINDS])
    expect(commenterGateOk(widened)).toBe(false)
  })

  it('a can_comment that admits a viewer fails the role check', () => {
    const widened = canCommentOf(MIGRATION).replace("'commenter')", "'commenter','viewer')")
    expect(canCommentRolesOk(widened)).toBe(false)
  })

  it('a suggestions read that uses is_editor fails the member-read check', () => {
    const editorRead = POLICIES.replace(
      'for select to authenticated using(public.is_member(trip_id) or public.is_admin());\n',
      'for select to authenticated using(public.is_editor(trip_id) or public.is_admin());\n',
    )
    expect(editorRead).not.toBe(POLICIES)
    expect(memberReadOk(editorRead, 'suggestions')).toBe(false)
  })
})
