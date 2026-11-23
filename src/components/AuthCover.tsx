// ============ Auth cover art ============
// The artwork behind the /auth glass panel (desktop) and the 150 px strip
// (phone). Both use one scene: the app's own generated winding hill road
// (`road-2`), drawn by RegionArt. The phone strip crops the same scene.
//
// Night art is one separate file pair in public/auth/. CSS shows one layer:
// the day art by default, the night art under [data-theme='dark'].
//
// The night image hides itself when its file is missing or fails to decode, so
// the dimmed day art (RegionArt's own dark scrim) stays as the fallback.
import { useState } from 'react'
import { RegionArt } from './RegionArt'

/** The generated art id for both covers. */
export const AUTH_COVER_ID = 'road-2'

/** The night file, served from public/. The @2x file backs the 2x srcset entry. */
export const AUTH_NIGHT_SRC = '/auth/cover-night.jpg'

function NightArt() {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const retina = AUTH_NIGHT_SRC.replace(/\.jpg$/, '@2x.jpg')
  return (
    <img
      className="auth-cover-night"
      src={AUTH_NIGHT_SRC}
      srcSet={`${AUTH_NIGHT_SRC} 1x, ${retina} 2x`}
      width={960}
      height={640}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => { setFailed(true) }}
    />
  )
}

/** The artwork layer of the cover. It fills its positioned parent. */
export function AuthCoverArt({ variant }: { variant: 'desktop' | 'phone' }) {
  const desktop = variant === 'desktop'
  return (
    <div className={`auth-cover-art auth-cover-art--${variant}`} aria-hidden="true">
      <RegionArt
        id={AUTH_COVER_ID}
        ratio={desktop ? '3:2' : '21:9'}
        sizes={desktop ? '(max-width: 1100px) 55vw, 760px' : '100vw'}
        eager={false}
        fallback={<span className="auth-cover-floor" />}
      />
      <NightArt />
    </div>
  )
}
