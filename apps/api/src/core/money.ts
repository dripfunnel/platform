// Money (PLATFORM-PROMPT §5.4; DATA-MODEL §7.1): an integer count of a currency's minor units with the
// currency beside it, every time. Rounding and decimals live here only; formatting is the clients' (Intl).

export interface Money {
  /** Minor units: cents, paise, yen. A bigint, since a sum can pass 2^53. */
  amount: bigint
  currency: string
}

// The ISO 4217 codes the runtime has data for: NumberFormat itself accepts any three letters.
const known: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'))

/** A currency by its ISO 4217 code; anything else is refused rather than guessed. */
export const isCurrency = (code: string): boolean => known.has(code)

/** How many decimals the currency's minor unit has: 2 for USD, 0 for JPY, 3 for KWD. */
export const minorDigits = (currency: string): number => {
  if (!isCurrency(currency)) throw new Error(`money: unknown currency ${currency}`)
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

/** The most any one amount may be: well inside Postgres bigint, and far above any real price. */
export const maxAmount = 10n ** 15n

const minorPattern = /^(0|[1-9][0-9]{0,15})$/

/** An amount as the APIs carry it (a string of minor units, since GraphQL's Int is 32-bit); null if it isn't one. */
export const parseMinor = (value: string, currency: string): Money | null => {
  if (!isCurrency(currency) || !minorPattern.test(value)) return null
  const amount = BigInt(value)
  return amount <= maxAmount ? { amount, currency } : null
}

/** A major-unit decimal ("1299.50") in minor units, refusing more decimals than the currency has. */
export const fromMajor = (value: string, currency: string): Money | null => {
  if (!isCurrency(currency)) return null
  const match = /^(0|[1-9][0-9]{0,12})(?:\.([0-9]+))?$/.exec(value.trim())
  if (!match) return null
  const digits = minorDigits(currency)
  const fraction = match[2] ?? ''
  if (fraction.length > digits) return null
  const amount = BigInt(match[1] ?? '0') * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')
  return amount <= maxAmount ? { amount, currency } : null
}

export const toMinorString = (money: Money): string => money.amount.toString()

const same = (a: Money, b: Money) => {
  if (a.currency !== b.currency) throw new Error(`money: ${a.currency} and ${b.currency} don't add`)
}

export const add = (a: Money, b: Money): Money => {
  same(a, b)
  return { amount: a.amount + b.amount, currency: a.currency }
}

export const compare = (a: Money, b: Money): -1 | 0 | 1 => {
  same(a, b)
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
}

/** A share in basis points (1/100 of a percent), rounded half away from zero: the one rounding rule. */
export const applyBps = (money: Money, bps: number): Money => {
  if (!Number.isInteger(bps)) throw new Error('money: basis points are whole')
  const scaled = money.amount * BigInt(bps)
  const half = scaled >= 0n ? 5000n : -5000n
  return { amount: (scaled + half) / 10000n, currency: money.currency }
}
