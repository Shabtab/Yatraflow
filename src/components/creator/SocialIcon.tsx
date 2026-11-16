// ============ Creator social icons — brand shapes drawn here, not imported ============
// lucide-react 1.34 carries no brand marks, and a camera and a TV read as
// "photo" and "video", not YouTube and Instagram. Each shape below is an
// original path: a rounded screen with a cut-out play triangle, a camera
// square with a lens ring, and an open ring for Threads. The current colour of
// the surrounding text drives all three, so no palette value lives in this file.
import { INLINE_ICON_VERTICAL_ALIGN } from '../icons'

/** `gap` is the space before a text label; pass 0 for an icon-only link. */
export function SocialIcon({ kind, size = 14, gap = 4 }: { kind: 'youtube' | 'instagram' | 'threads'; size?: number; gap?: number }) {
  const style = { display: 'inline-block', verticalAlign: INLINE_ICON_VERTICAL_ALIGN, marginRight: gap, flexShrink: 0 } as const
  if (kind === 'youtube') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="currentColor" style={style}>
        <path
          fillRule="evenodd"
          d="M7 5h10a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5v-4a5 5 0 0 1 5-5Zm3 4v6l5.5-3L10 9Z"
        />
      </svg>
    )
  }
  if (kind === 'threads') {
    // A ring with an open tail: the "@" shape the Threads mark is read as.
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={style}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M15.2 9.4v4.3c0 1.5 1.2 2.3 2.4 2.3 1.5 0 2.9-1.7 2.9-4.2A8.5 8.5 0 1 0 15 19.9" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} style={style}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}
