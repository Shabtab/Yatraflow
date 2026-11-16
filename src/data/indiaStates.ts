/** The 36 states and union territories of India, by ISO 3166-2:IN code.
 *  `col` and `row` place each state on the storefront tile grid (9 columns,
 *  8 rows). Positions follow the creator storefront mockup. Chandigarh has no
 *  mockup tile, so it takes the free cell beside Punjab. */

export interface IndiaState {
  readonly code: string
  readonly name: string
  readonly col: number
  readonly row: number
}

export const INDIA_STATES: readonly IndiaState[] = [
  { code: 'AN', name: 'Andaman and Nicobar Islands', col: 6, row: 7 },
  { code: 'AP', name: 'Andhra Pradesh', col: 3, row: 5 },
  { code: 'AR', name: 'Arunachal Pradesh', col: 8, row: 2 },
  { code: 'AS', name: 'Assam', col: 7, row: 3 },
  { code: 'BR', name: 'Bihar', col: 5, row: 2 },
  { code: 'CH', name: 'Chandigarh', col: 1, row: 1 },
  { code: 'CT', name: 'Chhattisgarh', col: 3, row: 3 },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', col: 0, row: 4 },
  { code: 'DL', name: 'Delhi', col: 3, row: 2 },
  { code: 'GA', name: 'Goa', col: 1, row: 5 },
  { code: 'GJ', name: 'Gujarat', col: 0, row: 3 },
  { code: 'HP', name: 'Himachal Pradesh', col: 3, row: 1 },
  { code: 'HR', name: 'Haryana', col: 2, row: 2 },
  { code: 'JH', name: 'Jharkhand', col: 4, row: 3 },
  { code: 'JK', name: 'Jammu and Kashmir', col: 2, row: 0 },
  { code: 'KA', name: 'Karnataka', col: 2, row: 5 },
  { code: 'KL', name: 'Kerala', col: 2, row: 6 },
  { code: 'LA', name: 'Ladakh', col: 3, row: 0 },
  { code: 'LD', name: 'Lakshadweep', col: 0, row: 7 },
  { code: 'MH', name: 'Maharashtra', col: 1, row: 4 },
  { code: 'ML', name: 'Meghalaya', col: 7, row: 4 },
  { code: 'MN', name: 'Manipur', col: 8, row: 4 },
  { code: 'MP', name: 'Madhya Pradesh', col: 2, row: 3 },
  { code: 'MZ', name: 'Mizoram', col: 8, row: 5 },
  { code: 'NL', name: 'Nagaland', col: 8, row: 3 },
  { code: 'OR', name: 'Odisha', col: 4, row: 4 },
  { code: 'PB', name: 'Punjab', col: 2, row: 1 },
  { code: 'PY', name: 'Puducherry', col: 4, row: 6 },
  { code: 'RJ', name: 'Rajasthan', col: 1, row: 2 },
  { code: 'SK', name: 'Sikkim', col: 6, row: 2 },
  { code: 'TG', name: 'Telangana', col: 3, row: 4 },
  { code: 'TN', name: 'Tamil Nadu', col: 3, row: 6 },
  { code: 'TR', name: 'Tripura', col: 7, row: 5 },
  { code: 'UP', name: 'Uttar Pradesh', col: 4, row: 2 },
  { code: 'UT', name: 'Uttarakhand', col: 4, row: 1 },
  { code: 'WB', name: 'West Bengal', col: 5, row: 3 },
]

export const INDIA_STATE_COUNT = INDIA_STATES.length

const BY_CODE = new Map(INDIA_STATES.map(state => [state.code, state] as const))

export function isIndiaStateCode(value: unknown): value is string {
  return typeof value === 'string' && BY_CODE.has(value)
}

export function indiaStateByCode(code: string): IndiaState | undefined {
  return BY_CODE.get(code)
}
