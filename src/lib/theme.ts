import { useSyncExternalStore } from 'react'
import { setNativeTheme } from './appShell'

const KEY = 'yatraflow_theme'
type Listener = () => void
const listeners = new Set<Listener>()
function emit() {
  listeners.forEach(l => l())
}

/** The currently applied theme (true = dark). Reads localStorage, no DOM. */
export function getTheme(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'dark'
}

/**
 * Apply + persist a theme and notify every subscriber (so App and the Profile
 * card — which live in different render trees — stay in step). Also paints the
 * Android status bar via the shared appShell helper.
 */
export function setTheme(dark: boolean): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, dark ? 'dark' : 'light')
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.querySelectorAll('meta[name="theme-color"]').forEach(m =>
      m.setAttribute('content', dark ? '#0C1420' : '#FAF7F2'))
  }
  void setNativeTheme(dark)
  emit()
}

/** Subscribe a component to the active theme; re-renders on any setTheme(). */
export function useTheme(): boolean {
  return useSyncExternalStore(
    cb => {
      const l: Listener = () => cb()
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getTheme,
    () => false,
  )
}