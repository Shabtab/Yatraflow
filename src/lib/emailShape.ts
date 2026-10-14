/** True when the text has the shape of an email address: one "@", text on
 *  both sides, and a dot in the domain part. It is a shape check only. The
 *  server decides whether the address is real. The Auth form uses it because
 *  the form sets noValidate, so the browser no longer checks the field. */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
}
