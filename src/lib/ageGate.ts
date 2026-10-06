// ============ Age gate at signup ============
// Accounts are adults-only. India's DPDP Act 2023 treats under-18 users as
// children whose data needs verifiable parental consent. Razorpay account
// holders are 18+. The date of birth is checked at signup and deliberately
// NOT stored — data minimisation.

export const MIN_SIGNUP_AGE = 18

/** Completed years from a 'YYYY-MM-DD' birth date.
 *  Returns null for a bad shape, an impossible date, or a future date. */
export function ageFromDob(dob: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  // A real calendar date only: Date.UTC rolls overflow over (day 32 becomes
  // Feb 1, month 13 becomes the next year), so the round trip must land on
  // the same year, month and day the input named.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  const nowYear = today.getFullYear()
  const nowMonth = today.getMonth() + 1
  const nowDay = today.getDate()
  const beforeAnniversary = month > nowMonth || (month === nowMonth && day > nowDay)
  if (year > nowYear || (year === nowYear && beforeAnniversary)) return null
  // A Feb-29 birth is compared as (2, 29): on Feb 28 of the turning year
  // the age is still one less.
  return nowYear - year - (beforeAnniversary ? 1 : 0)
}

/** True only when the birth date parses to an age of MIN_SIGNUP_AGE or more. */
export function isAdultSignup(dob: string, today: Date): boolean {
  const age = ageFromDob(dob, today)
  return age !== null && age >= MIN_SIGNUP_AGE
}
