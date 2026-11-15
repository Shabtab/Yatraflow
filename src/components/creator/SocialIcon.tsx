// ============ Creator social icons — brand shapes drawn here, not imported ============
// lucide-react 1.34 carries no brand marks, and a camera and a TV read as
// "photo" and "video", not YouTube and Instagram. Each shape below is an
// original path: a rounded screen with a cut-out play triangle, and a camera
// square with a lens ring. The current colour of the surrounding text drives
// both, so no palette value lives in this file.
export function SocialIcon({ kind, size = 14 }: { kind: 'youtube' | 'instagram'; size?: number }) {
  const style = { display: 'inline-block', verticalAlign: '-2px', marginRight: 4, flexShrink: 0 } as const
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
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} style={style}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}
