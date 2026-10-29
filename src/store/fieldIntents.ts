import type { PrivateUserProfile } from '../data/types'

const FIELDS = [
  'name', 'avatarUrl', 'isCreator', 'creatorBio', 'socialLinks', 'creatorAvailable',
  'homeCity', 'languages', 'travelStyles', 'isDisabled',
] as const satisfies readonly (keyof PrivateUserProfile)[]

type ProfilePatch = Partial<PrivateUserProfile>
type Intent = { operationId: number; patch: ProfilePatch; outcome: 'pending' | 'accepted' | 'failed' }

export interface FieldLedger {
  base: PrivateUserProfile
  intents: Intent[]
}

export function beginLedger(ledger: FieldLedger | undefined, base: PrivateUserProfile, operationId: number, patch: ProfilePatch): FieldLedger {
  return { base: ledger?.base ?? { ...base }, intents: [...(ledger?.intents ?? []), { operationId, patch, outcome: 'pending' }] }
}

export function settleLedger(ledger: FieldLedger, operationId: number, outcome: 'accepted' | 'failed'): FieldLedger {
  return { ...ledger, intents: ledger.intents.map(intent => intent.operationId === operationId ? { ...intent, outcome } : intent) }
}

export function ledgerHasPending(ledger: FieldLedger): boolean {
  return ledger.intents.some(intent => intent.outcome === 'pending')
}

function applyField<K extends keyof PrivateUserProfile>(out: PrivateUserProfile, ledger: FieldLedger, key: K): void {
  if (!ledger.intents.some(intent => Object.prototype.hasOwnProperty.call(intent.patch, key))) return
  const last = [...ledger.intents].reverse().find(intent => intent.outcome !== 'failed' && Object.prototype.hasOwnProperty.call(intent.patch, key))
  const value: unknown = Reflect.get(last ? last.patch : ledger.base, key)
  if (value === undefined) Reflect.deleteProperty(out, key)
  else Object.defineProperty(out, key, { value, enumerable: true, configurable: true, writable: true })
}

/** Override only fields with local intents. Keep unrelated values from the current row. */
export function applyLedger(ledger: FieldLedger, current: PrivateUserProfile): PrivateUserProfile {
  const out = { ...current }
  for (const key of FIELDS) applyField(out, ledger, key)
  return out
}
