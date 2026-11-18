// ============ Map v2: the stop card's ways out ============
// The stop edit card closes from its own button, from Escape, and from a click
// on bare map. The page owns the selected stop, so it also owns the close.
// A node test cannot fire a DOM event, so the Escape decision is a pure
// function of what the event looked like.

/** What the key event looked like, in the terms the decision needs. */
export type CardCloseKey = {
  key: string
  /** A menu inside the card already took the key. */
  defaultPrevented: boolean
  /** The key started in a text field. */
  inTextField: boolean
  /** The key started in another dialog, such as the add modal. */
  inOtherDialog: boolean
}

/** A text field keeps Escape: it belongs to whatever the user is typing in. */
const TEXT_FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
/** Another dialog keeps Escape: it closes that dialog, not this card. */
const OTHER_DIALOG = '[role="dialog"], [role="alertdialog"], .modal, .ai-drawer'

/**
 * Escape closes the stop card only when no other surface took the key first.
 * The card's day menu and swap menu call preventDefault and stop propagation
 * on their own Escape, so the key that reaches here is a real card Escape.
 */
export function escapeClosesCard(event: CardCloseKey): boolean {
  if (event.key !== 'Escape') return false
  if (event.defaultPrevented) return false
  if (event.inTextField) return false
  if (event.inOtherDialog) return false
  return true
}

/** Read a real keydown into the terms `escapeClosesCard` decides on. */
export function cardCloseFromEvent(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null
  return escapeClosesCard({
    key: event.key,
    defaultPrevented: event.defaultPrevented,
    inTextField: target?.closest(TEXT_FIELD) != null,
    inOtherDialog: target?.closest(OTHER_DIALOG) != null,
  })
}
