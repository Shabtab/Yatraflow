import { Capacitor } from '@capacitor/core'
import type { MouseEvent } from 'react'
import { navigate, routeHref } from './router'

type AppRoute = `/${string}`
type LinkClick = Pick<MouseEvent, 'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented'>

/** Web links carry the real path itself (the address bar and the router read
 *  the same pathname now, #426 slice 2); native and file builds keep the
 *  fragment form, whose route lives in the hash until slice 4. */
export function appLinkHref(route: AppRoute, native = false, protocol = 'https:'): string {
  return routeHref(route, native, protocol)
}

export function shouldHandleAppLink(event: LinkClick, target = '', download = false): boolean {
  return !event.defaultPrevented && event.button === 0 &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    (!target || target === '_self') && !download
}

/** Spread onto a real anchor: browser-owned new tabs, in-document navigation
 *  for same-tab clicks. The preventDefault matters on the web — an anchor
 *  whose href is a real path would otherwise be a FULL page load, dropping
 *  the store, the session's scroll and the offline shell; navigation must
 *  stay one pushState inside the running document. */
export function appLink(route: AppRoute) {
  return {
    href: appLinkHref(route, Capacitor.isNativePlatform(), location.protocol),
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (!shouldHandleAppLink(event, event.currentTarget.target, event.currentTarget.hasAttribute('download'))) return
      event.preventDefault()
      navigate(route)
    },
  }
}
