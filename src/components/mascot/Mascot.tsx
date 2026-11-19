// ============ Chakra mascot ============
// The app's mascot art (docs/MASCOT-PLAN.md). `pose` picks the drawing, `size`
// the square in pixels, and `animated` asks for the looping file where the pose
// has one. The dark theme takes the night variant.
//
// The image is decoration, so it is always `alt=""` + `aria-hidden`: the text
// beside it carries the message (plan §2.3). Loads are lazy: each file is a few
// kilobytes and most states sit below the fold.
import { useTheme } from '../../lib/theme'
import { mascotFile, type MascotPose } from '../../lib/mascot'

export function Mascot({ pose, size = 120, animated = false, center = false, inline = false }: {
  pose: MascotPose
  /** The square the art is drawn in, in pixels. */
  size?: number
  /** Use the looping file. A pose with no still file always animates. */
  animated?: boolean
  /** Centre the art in its column. Pages use this instead of a wrapper style. */
  center?: boolean
  /**
   * Ride beside the text instead of taking a row of its own. The inline
   * warnings use this at 24 to 32 px (plan §3).
   */
  inline?: boolean
}) {
  const dark = useTheme()
  const file = mascotFile(pose, { animated, dark })
  if (!file) return null
  return (
    <img
      src={`${import.meta.env.BASE_URL}${file}`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: inline ? 'inline-block' : 'block',
        verticalAlign: inline ? 'middle' : undefined,
        flex: inline ? 'none' : undefined,
        margin: center ? '0 auto' : undefined,
        marginRight: inline ? 6 : undefined,
      }}
    />
  )
}
