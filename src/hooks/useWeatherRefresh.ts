import { useEffect, useState } from 'react'

/** How often open forecasts are re-pulled so they never go stale on screen. */
export const WEATHER_REFRESH_MS = 5 * 60 * 1000

/**
 * A counter that advances on a fixed cadence AND whenever the tab regains focus
 * or becomes visible again — so returning to the app (or leaving it open) pulls
 * a fresh forecast instead of showing a snapshot taken hours ago.
 *
 * Consumers add the returned `tick` to their fetch effect's deps and pass
 * `{ force: tick > 0 }` to `fetchDailyWeather`, which bypasses the short-lived
 * cache and re-pulls from Open-Meteo.
 */
export function useWeatherRefreshTick(intervalMs: number = WEATHER_REFRESH_MS): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    const id = window.setInterval(bump, intervalMs)
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    window.addEventListener('focus', bump)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', bump)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return tick
}
