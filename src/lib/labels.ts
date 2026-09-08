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
