// RFC 6238 with the authenticator defaults: HMAC-SHA1, 30-second steps, 6 digits.
const stepSeconds = 30
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const stepAt = (now: Date): number => Math.floor(now.getTime() / 1000 / stepSeconds)

/** A 160-bit secret in base32, the form authenticator apps take. */
export const newTotpSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let bits = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')
  return (bits.match(/.{5}/g) ?? []).map((chunk) => alphabet[Number.parseInt(chunk, 2)]).join('')
}

const fromBase32 = (secret: string): Uint8Array<ArrayBuffer> => {
  let bits = ''
  for (const char of secret.replaceAll(/[\s=]/g, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value >= 0) bits += value.toString(2).padStart(5, '0')
  }
  return Uint8Array.from(bits.match(/.{8}/g) ?? [], (byte) => Number.parseInt(byte, 2))
}

export const codeAt = async (secret: string, step: number): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', fromBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const counter = new DataView(new ArrayBuffer(8))
  counter.setBigUint64(0, BigInt(step))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter.buffer))
  const offset = (mac[mac.length - 1] ?? 0) & 0xf
  const value = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0)
  return (value % 1_000_000).toString().padStart(6, '0')
}

export type CodeCheck = { ok: true; step: number } | { ok: false; code: 'WRONG_CODE' | 'CODE_EXPIRED' }

/**
 * One step either side for clock drift. A code from the last five minutes, or one already used,
 * is `CODE_EXPIRED` and does not count as a wrong guess (FIRST-RELEASE §3 tells the two apart).
 */
export const checkCode = async (secret: string, code: string, now: Date, lastUsedStep: number | null): Promise<CodeCheck> => {
  if (!/^\d{6}$/.test(code)) return { ok: false, code: 'WRONG_CODE' }
  const current = stepAt(now)
  for (let step = current - 10; step <= current + 1; step += 1) {
    if ((await codeAt(secret, step)) !== code) continue
    const fresh = step >= current - 1 && (lastUsedStep === null || step > lastUsedStep)
    return fresh ? { ok: true, step } : { ok: false, code: 'CODE_EXPIRED' }
  }
  return { ok: false, code: 'WRONG_CODE' }
}

export const otpauthUri = (secret: string, account: string): string =>
  `otpauth://totp/${encodeURIComponent(`DripFunnel Partners:${account}`)}?secret=${secret}&issuer=${encodeURIComponent('DripFunnel Partners')}`
