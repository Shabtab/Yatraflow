// ============ Sign-up password meter ============
// Pure and dependency-free (node-testable). The sign-up form shows how many
// characters the password still needs. The count follows the typing, so the
// user does not learn the rule only after a failed submit.
//
// The length rule itself lives in Auth.tsx (`password.length < 8`) and in the
// field's `minLength`. This helper counts with the same measure, `.length`.

/** The shortest password the sign-up form accepts. */
export const PASSWORD_MIN_LENGTH = 8

/** The neutral hint. It shows before typing starts and once the password is long enough. */
export const PASSWORD_HINT = 'At least 8 characters'

export interface PasswordMeter {
  /** True while the user has typed some characters but fewer than the minimum. */
  short: boolean
  /** Characters still needed. 0 when the password is long enough. */
  remaining: number
  /** The hint line to show under the field. */
  text: string
}

/**
 * The live hint for a password being typed.
 *
 * An empty field is not "short": the user has not started, so the neutral hint
 * stays and the error colour does not show on a fresh form.
 */
export function passwordMeter(password: string): PasswordMeter {
  const length = password.length
  const remaining = Math.max(0, PASSWORD_MIN_LENGTH - length)
  if (length === 0 || remaining === 0) {
    return { short: false, remaining, text: PASSWORD_HINT }
  }
  return { short: true, remaining, text: `${PASSWORD_HINT}, ${remaining} more to go` }
}
