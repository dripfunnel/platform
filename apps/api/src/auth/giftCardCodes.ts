// A gift card's code (CATALOG-DESIGN T14): 16 characters with no 0/O or 1/I to misread, 80 bits, shown in fours. Only
// its hash is kept, salted with the store so the same code in two stores never meets (ACCESS §6.1's token rule).

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const newGiftCardCode = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => alphabet[b & 31]).join('')

export const formatGiftCardCode = (code: string): string => code.match(/.{4}/g)?.join('-') ?? code

/** What the shopper typed, as the code it could be; null when it can't be one, which is answered as any wrong code. */
export const normaliseGiftCardCode = (typed: string): string | null => {
  const code = typed.toUpperCase().replaceAll(/[\s-]/g, '')
  return /^[A-HJ-NP-Z2-9]{16}$/.test(code) ? code : null
}

export const hashGiftCardCode = async (storeId: string, code: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${storeId}:${code}`)))].map((b) => b.toString(16).padStart(2, '0')).join('')
