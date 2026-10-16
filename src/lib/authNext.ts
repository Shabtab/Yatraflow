/** Accept only a same-app path. Queries, fragments, schemes, and host redirects are refused. */
export function authNext(raw: string | null): string {
  if (!raw) return '/trips'
  let path = raw
  try { path = decodeURIComponent(raw) } catch { /* Validate the original value. */ }
  return /^\/[a-z0-9_\-/]*$/i.test(path) && !path.includes('//') ? path : '/trips'
}
