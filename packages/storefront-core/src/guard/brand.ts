import { asRead } from './claims.js'
import type { GuardContext } from './rules.js'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isDigit = (cp: number) => /\p{Nd}/u.test(String.fromCodePoint(cp))

/** A digit of any script as 0–9: each script's digits run from its zero in one block. */
const digitValue = (c: string) => {
  const cp = c.codePointAt(0) ?? 0
  let zero = cp
  while (isDigit(zero - 1)) zero -= 1
  return String((cp - zero) % 10)
}

const digits = (text: string) => text.replace(/\P{Nd}/gu, '').replace(/\p{Nd}/gu, digitValue)
const bareLink = (url: string) => url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')

type Field = { label: string; copies: (text: string) => boolean }

const phrase = (label: string, value: string | null): Field[] => {
  if (!value || value.length < 3) return []
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(asRead(value)).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu')
  return [{ label, copies: (text) => pattern.test(text) }]
}

/**
 * Which of the store's Site settings a piece of the theme's words copies (DESIGN §2: read, never copied).
 * A one-word shop name under six letters is skipped, so a shop called "Home" can still say "Home".
 */
export const brandCopied = (brand: GuardContext['brand']): ((text: string) => string | undefined) => {
  const name = /\s/.test(brand.name) || brand.name.length >= 6 ? phrase('shop name', brand.name) : []
  const email = brand.email?.toLowerCase()
  // The national number, so a copy without the country code is caught too.
  const phone = digits(brand.phone ?? '').slice(-10)
  const fields: Field[] = [
    ...name,
    ...phrase('tagline', brand.tagline),
    ...brand.address.flatMap((line) => phrase('address', line)),
    ...(email ? [{ label: 'contact email', copies: (text: string) => text.toLowerCase().includes(email) }] : []),
    ...(phone.length >= 7 ? [{ label: 'contact phone', copies: (text: string) => digits(text).includes(phone) }] : []),
    ...brand.socialLinks.map(bareLink).filter((link) => link.length >= 3).map((link) => ({ label: 'social link', copies: (text: string) => text.toLowerCase().includes(link) })),
  ]
  return (text) => {
    const read = asRead(text)
    return fields.find((f) => f.copies(read))?.label
  }
}
