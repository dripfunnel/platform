// An email address as a shopper or a merchant types one: trimmed, lower case, the loose shape and SMTP's 254 characters.
const shape = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/

/** The address, or null when it can't be one. */
export const cleanEmail = (value: string): string | null => {
  const e = value.trim().toLowerCase()
  return e.length <= 254 && shape.test(e) ? e : null
}
