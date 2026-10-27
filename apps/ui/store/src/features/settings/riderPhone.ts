/** The store's country dialling code, where one is known; anything else must be typed with its +code. */
const dialCodes: Readonly<Record<string, string>> = { IN: '+91', US: '+1', CA: '+1', GB: '+44', AE: '+971', AU: '+61', NZ: '+64', SG: '+65' }

// The API's own rule (apps/api/src/core/sms.ts isE164).
const e164 = /^\+[1-9]\d{6,14}$/

export const dialCodeOf = (country: string | null): string => (country ? (dialCodes[country] ?? '') : '')

/** What the Owner typed as the number the API takes: spaces and dashes out, the store's code in front of a national number. */
export const toE164 = (typed: string, dialCode: string): string => {
  const bare = typed.replace(/[\s\-().]/g, '')
  if (bare.startsWith('+')) return bare
  if (bare.startsWith('00')) return `+${bare.slice(2)}`
  const code = dialCode.slice(1)
  // A national number is at least ten digits, so the code plus ten is already international.
  if (code && bare.startsWith(code) && bare.length >= code.length + 10) return `+${bare}`
  return dialCode ? `${dialCode}${bare.replace(/^0+/, '')}` : bare
}

export const isMobile = (typed: string, dialCode: string): boolean => e164.test(toE164(typed, dialCode))
