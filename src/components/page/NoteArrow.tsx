// ============ Note arrow ============
// The hand-drawn arrow that points from a handwritten note. It is decoration,
// so assistive technology skips it. The head sits on the end of the shaft, and
// its two wings sit at plus and minus 35 degrees from the shaft's end. The
// note's CSS sizes the svg and mirrors it on narrow screens.
export function NoteArrow() {
  return (
    <svg viewBox="0 0 54 62" focusable="false" aria-hidden="true">
      <path d="M8 4c14 4 30 16 30 34 0 6-2 11-6 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M41.6 51.2 32 54 32.6 44" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
