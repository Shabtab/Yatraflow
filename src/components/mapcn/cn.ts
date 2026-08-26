// tiny local shim for mapcn's '@/lib/utils' import
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
