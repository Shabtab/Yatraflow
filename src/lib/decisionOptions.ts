// Add an option to an open decision: pure checks.
//
// The SERVER enforces every rule here (supabase/migrations/
// 20261117_group_input_phase2.sql). The client runs the same checks first so a
// refused option never flashes on screen. Keep the limits equal to the SQL.

import type { DecisionOption, TripDecision } from '../data/types'
import { isVoteOpen } from './decisionClock'

/** The decision.create command allows 20 options, and so does add-option. */
export const MAX_DECISION_OPTIONS = 20
export const MAX_OPTION_LABEL_LENGTH = 200

/** How two labels compare: trimmed and lower-case. The SQL uses
 *  `lower(btrim(label))`. */
export function normalizeOptionLabel(label: string): string {
  return label.trim().toLowerCase()
}

export function findDuplicateOption(options: readonly DecisionOption[], label: string): DecisionOption | undefined {
  const wanted = normalizeOptionLabel(label)
  return options.find(o => normalizeOptionLabel(o.label) === wanted)
}

export type OptionLabelCheck =
  | { ok: true; label: string }
  | { ok: false; reason: 'empty' | 'too long' | 'duplicate' | 'too many options' }

/** Check a typed label against the decision's current options. On success the
 *  label comes back trimmed, which is the text the server stores. */
export function checkNewOptionLabel(options: readonly DecisionOption[], label: string): OptionLabelCheck {
  const trimmed = label.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length > MAX_OPTION_LABEL_LENGTH) return { ok: false, reason: 'too long' }
  if (options.length >= MAX_DECISION_OPTIONS) return { ok: false, reason: 'too many options' }
  if (findDuplicateOption(options, trimmed)) return { ok: false, reason: 'duplicate' }
  return { ok: true, label: trimmed }
}

/** The decision takes a new option now: it is open, its closing time has not
 *  passed and it has room. Who may add is a separate question the server
 *  answers: the same members who can vote. */
export function canAddOption(d: Pick<TripDecision, 'status' | 'closesAt' | 'options'>, now: number): boolean {
  return isVoteOpen(d, now) && d.options.length < MAX_DECISION_OPTIONS
}
