// ============ Native bridge (Capacitor) ============
// One thin layer between the web app and on-device capabilities. On the web
// every helper degrades to the plain browser API; inside the Capacitor shell
// (installed from an app store, `npx cap run android`) the same call routes
// through the native plugin, which works where the WebView's own API is
// missing or permission-gated.
//
// Silence is the contract (same as haptics.ts): helpers never throw to the
// caller — callers keep their web fallbacks, so behavior off-device is
// unchanged from before this file existed.

import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Geolocation, type Position as NativePosition } from '@capacitor/geolocation'
import { Share } from '@capacitor/share'

/** True only inside a packaged app (android/ios), not on any web host. */
export const isNative = Capacitor.isNativePlatform()
export const isAndroid = Capacitor.getPlatform() === 'android'

/** Plain text clipboard. Returns false when every path failed. */
export async function nativeCopyText(text: string): Promise<boolean> {
  if (isNative) {
    try {
      await Clipboard.write({ string: text, label: 'YatraFlow link' })
      return true
    } catch { /* plugin failure → web fallback below */ }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { return false }
}

/**
 * PNG image clipboard. The plugin wants a full data URL (with prefix) —
 * the same string FileReader produces, so no stripping. Returns false when
 * unsupported or failed so callers can fall back to download.
 */
export async function nativeCopyImage(blob: Blob): Promise<boolean> {
  if (isNative) {
    try {
      const dataUrl = await blobToDataUrl(blob)
      await Clipboard.write({ image: dataUrl })
      return true
    } catch { /* plugin failure → web fallback below */ }
  }
  try {
    if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return true
    }
  } catch { /* fall through */ }
  return false
}

/**
 * System share sheet for text/links. Returns 'shared' when a sheet was shown
 * (even if the user dismissed it), 'unavailable' when no share mechanism
 * exists — callers then fall back to the clipboard. Never throws.
 */
export async function nativeShareText(data: {
  text: string
  title?: string
  url?: string
  dialogTitle?: string
}): Promise<'shared' | 'unavailable'> {
  if (isNative) {
    try {
      await Share.share(data)
      return 'shared'
    } catch { /* dismissed sheet or plugin error → treat as unavailable */ }
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ text: data.text, title: data.title, url: data.url })
      return 'shared'
    } catch { /* AbortError (dismiss) or failure → unavailable */ }
  }
  return 'unavailable'
}

const PNG_EXPORT_NAME = 'yatraflow-trip.png'

/**
 * System share sheet for the trip-estimate PNG. On device the blob is written
 * to the app cache dir (the Share plugin only takes file:// URLs) and handed
 * to the native sheet; web keeps the original canShare({files}) path, then
 * clipboard, then download.
 */
export async function nativeShareImage(
  blob: Blob,
  title: string,
): Promise<'shared' | 'copied' | 'downloaded' | 'dismissed'> {
  if (isNative) {
    try {
      const base64 = await blobToBase64(blob)
      await Filesystem.writeFile({
        path: PNG_EXPORT_NAME,
        data: base64,
        directory: Directory.Cache,
      })
      const { uri } = await Filesystem.getUri({ path: PNG_EXPORT_NAME, directory: Directory.Cache })
      await Share.share({ title, dialogTitle: title, files: [uri] })
      return 'shared'
    } catch { /* dismissed or failed → fall through to web paths */ }
  }
  const file = new File([blob], PNG_EXPORT_NAME, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'dismissed'
    }
  }
  if (await nativeCopyImage(blob)) return 'copied'
  return 'downloaded'
}

/**
 * Open a URL outside the app. Inside the Android shell an anchor with
 * target="_blank" goes nowhere (WebViews create no new window and no
 * navigation happens), but window.open() routes through the WebViewClient,
 * whose shouldOverrideUrlLoading fires an ACTION_VIEW intent for any
 * off-origin URL — Google Maps opens in the real app/browser. On the web
 * this is a normal window.open, same tab behavior preserved.
 */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * One-shot device location. On device the plugin triggers the system
 * permission dialog (which the WebView's plain getCurrentPosition never
 * does inside Capacitor) and reads the fused provider. Web keeps the
 * existing behavior. Resolves null on any failure — callers treat null as
 * "locate me unavailable".
 */
export async function nativeLocate(): Promise<GeolocationPosition | null> {
  if (isNative) {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10_000,
      })
      return toGeolocationPosition(pos)
    } catch { return null }
  }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  })
}

/** Handle returned by nativeWatch — call to stop the stream and clean up. */
export type WatchHandle = { stop: () => void }

/**
 * Continuous position stream for the live map dot. Native uses the plugin's
 * watchPosition (fused provider, system permission dialog); web uses the
 * browser watch. Errors surface through the same onFix(null) contract.
 */
export function nativeWatch(
  onFix: (pos: GeolocationPosition | null) => void,
): WatchHandle {
  if (isNative) {
    let callbackId: string | null = null
    void Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 15_000 },
      (pos, err) => {
        if (err) { onFix(null); return }
        if (pos) onFix(toGeolocationPosition(pos))
      },
    ).then(id => { callbackId = id }).catch(() => onFix(null))
    return {
      stop: () => {
        if (callbackId) void Geolocation.clearWatch({ id: callbackId }).catch(() => {})
      },
    }
  }
  if (!('geolocation' in navigator)) return { stop: () => {} }
  const wid = navigator.geolocation.watchPosition(
    p => onFix(p),
    () => onFix(null),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
  )
  return { stop: () => navigator.geolocation.clearWatch(wid) }
}

// ---------- helpers ----------

/** Adapt the plugin's Position to the browser GeolocationPosition shape. */
function toGeolocationPosition(pos: NativePosition): GeolocationPosition {
  const coords: GeolocationCoordinates = {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    altitude: pos.coords.altitude,
    altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
    heading: pos.coords.heading,
    speed: pos.coords.speed,
    toJSON: () => ({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      altitude: pos.coords.altitude,
      altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
    }),
  }
  return {
    coords,
    timestamp: pos.timestamp,
    toJSON: () => ({ coords, timestamp: pos.timestamp }),
  } satisfies GeolocationPosition
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return blobToDataUrl(blob).then(s => s.slice(s.indexOf(',') + 1))
}
