// The API's own rule (apps/api/src/core/sms.ts isE164).
const e164 = /^\+[1-9]\d{6,14}$/

/** The number as the API takes it: separators out and a 00 prefix as +. */
export const toE164 = (typed: string): string => {
  const bare = typed.replace(/[\s\-().]/g, '')
  return bare.startsWith('00') ? `+${bare.slice(2)}` : bare
}

export const isMobile = (typed: string): boolean => e164.test(toE164(typed))
