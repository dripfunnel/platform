// ACCESS.md §2: PBKDF2-SHA256, 100,000 iterations (the most the Workers runtime allows), a
// 16-byte random salt and a 32-byte key, stored as `pbkdf2-sha256$<iterations>$<salt>$<key>`.
const iterations = 100_000
const encoder = new TextEncoder()

export const minPasswordLength = 10

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

const derive = async (password: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256))
}

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(await derive(password, salt, iterations))}`
}

const equal = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

// A fixed hash to check against when there is no account, so an unknown email costs the same
// derivation as a wrong password (ACCESS.md §2).
const decoy = `pbkdf2-sha256$${iterations}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`

/** False for a malformed or missing hash too, after the same work. */
export const verifyPassword = async (password: string, stored: string | null): Promise<boolean> => {
  const [scheme, rounds, salt, key] = (stored ?? decoy).split('$')
  const valid = scheme === 'pbkdf2-sha256' && rounds !== undefined && salt !== undefined && key !== undefined
  const derived = await derive(password, fromBase64(valid ? salt : 'AAAAAAAAAAAAAAAAAAAAAA=='), valid ? Number(rounds) : iterations)
  return valid && stored !== null && equal(derived, fromBase64(key))
}
