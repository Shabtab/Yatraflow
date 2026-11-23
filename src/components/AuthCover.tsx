import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../lib/theme'

export function AuthCoverArt() {
  const dark = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const connection = 'connection' in navigator ? navigator.connection : undefined
  const saveData = Boolean(connection && typeof connection === 'object' && 'saveData' in connection && connection.saveData)
  const scene = dark ? 'night' : 'day'
  const poster = `/auth/cover-${scene}-poster.jpg`

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { setReducedMotion(query.matches) }
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let onScreen = false
    const update = () => {
      if (document.hidden || !onScreen) video.pause()
      else void video.play().catch(() => {})
    }
    const observer = new IntersectionObserver(entries => {
      onScreen = entries[0]?.isIntersecting ?? false
      update()
    })
    observer.observe(video)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [scene, reducedMotion, saveData])

  return (
    <div className="auth-cover-art" aria-hidden="true">
      {reducedMotion || saveData ? (
        <img className="auth-cover-media" src={poster} alt="" />
      ) : (
        <video key={scene} ref={videoRef} className="auth-cover-media" muted autoPlay loop playsInline preload="metadata" poster={poster} aria-hidden="true" tabIndex={-1} disablePictureInPicture>
          <source src={`/auth/cover-${scene}.webm`} type="video/webm" />
          <source src={`/auth/cover-${scene}.mp4`} type="video/mp4" />
        </video>
      )}
    </div>
  )
}
