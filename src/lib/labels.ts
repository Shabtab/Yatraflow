// ============ Label formatters for enum values ============
// The data model stores machine values ('food-focused', 'needs-booking',
// 'transport-hub'); these turn them into the words the UI shows. One home for
// them, because every surface used to grow its own copy and Trip Settings /
// Plan Bench forgot to use any — raw lowercase enums leaked into selects and
// chips ("car", "food-focused", "budget").

/** First letter uppercase, the rest unchanged ('food-focused' → 'Food-focused').
 *  The remainder is deliberately left as-is: callers may pass mixed text. */
export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Every hyphen becomes a space and every word is capitalised
 *  ('transport-hub' → 'Transport Hub'). */
export function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}

/** Status text reads as a sentence ('needs-booking' → 'Needs booking'). */
export function statusLabel(s: string): string {
  return cap(s.replace(/-/g, ' '))
}

/**
 * Where an inserted stop lands, in words — the ONE phrasing (#422): the leg's
 * insertion control announces it, and the quick-add dialog repeats it, so what
 * a screen reader hears at the button is what the dialog confirms.
 *
 * `beforeTitle` is the stop the new one follows, `afterTitle` the stop it
 * precedes; both undefined means the day is empty (the slot is the start).
 */
export function insertionWhere(beforeTitle?: string, afterTitle?: string): string {
  // Auto anchors carry a " (start)"/" (end)" suffix for the engine's benefit;
  // a sentence that names a neighbour to a person drops it.
  const clean = (t?: string) => t?.replace(/ \((start|end)\)$/, '')
  const before = clean(beforeTitle)
  const after = clean(afterTitle)
  if (before && after) return `between “${before}” and “${after}”`
  if (after) return `before “${after}”`
  if (before) return `after “${before}”`
  return 'at the start of the day'
}
