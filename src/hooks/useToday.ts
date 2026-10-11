import { useEffect, useState } from 'react'
import { createDayClock, startOfLocalDay } from '../lib/dayClock'

/**
 * The one calendar day a page reads (#648).
 *
 * Returns local midnight of the day in view. The value moves at local midnight,
 * when the window regains focus, and when the tab becomes visible again. A
 * background tab throttles timers, so the focus listeners are what keep a
 * long-open page honest.
 *
 * Call it once per page and pass the value down. Two callers would keep two
 * clocks and could print two different days.
 */
export function useToday(): Date {
  const [day, setDay] = useState(() => startOfLocalDay(new Date()))

  useEffect(() => {
    const clock = createDayClock({
      // Keep the old Date when the day did not move, so React can skip a render.
      onChange: next => setDay(prev => (prev.getTime() === next.getTime() ? prev : next)),
    })
    const onWake = () => clock.refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') clock.refresh()
    }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clock.stop()
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return day
}
