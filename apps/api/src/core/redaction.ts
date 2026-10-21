// LOGGING.md §4.1: a changed field whose name says it holds a credential or payment detail is
// recorded as changed, with no values. Matched on whole words of the field name with plurals
// folded, so `postcode` and `country_code` are kept while `verification_code` is not, and the
// same words inside an object-valued field are redacted where they sit.
export const redactedFields = [
  'password',
  'passphrase',
  'password hash',
  'token',
  'secret',
  'credential',
  'api key',
  'private key',
  'key secret',
  'session id',
  'verification code',
  'recovery code',
  'otp',
  'card number',
  'pan',
  'cvc',
  'cvv',
  'iban',
  'account number',
  'routing number',
  'bank details',
  'two factor secret',
] as const

export const redactedValue = '[redacted]'

export interface Change {
  field: string
  before: unknown
  after: unknown
}

export interface RecordedChange {
  field: string
  before: string | null
  after: string | null
  redacted: boolean
}

const singular = (word: string): string => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)

const words = (field: string): string =>
  field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular)
    .join(' ')

export const isRedactedField = (field: string): boolean => {
  const name = ` ${words(field)} `
  return redactedFields.some((pattern) => name.includes(` ${pattern} `))
}

const redactWithin = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactWithin)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, isRedactedField(key) ? redactedValue : redactWithin(inner)]),
    )
  }
  return value
}

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : JSON.stringify(redactWithin(value))
}

export const redactChanges = (changes: readonly Change[]): RecordedChange[] =>
  changes.map(({ field, before, after }) =>
    isRedactedField(field)
      ? { field, before: null, after: null, redacted: true }
      : { field, before: asText(before), after: asText(after), redacted: false },
  )
