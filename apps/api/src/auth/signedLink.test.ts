import { describe, expect, it } from 'vitest'
import { formatGiftCardCode, hashGiftCardCode, newGiftCardCode, normaliseGiftCardCode } from './giftCardCodes'
import { linkSigner } from './signedLink'

const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)))

describe('signed links', () => {
  it('verify what they signed, and nothing else, under another key or purpose', async () => {
    const signer = await linkSigner(key(1), 'download-links')
    const signature = await signer.sign('download:s:g')
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await signer.verify('download:s:g', signature)).toBe(true)
    expect(await signer.verify('download:s:h', signature)).toBe(false)
    expect(await signer.verify('download:s:g', 'not-a-signature')).toBe(false)
    expect(await (await linkSigner(key(2), 'download-links')).verify('download:s:g', signature)).toBe(false)
    expect(await (await linkSigner(key(1), 'other')).verify('download:s:g', signature)).toBe(false)
  })
})

describe('gift card codes', () => {
  it('are 16 unambiguous characters, read back however they are typed, hashed per store', async () => {
    const code = newGiftCardCode()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/)
    expect(normaliseGiftCardCode(` ${formatGiftCardCode(code).toLowerCase()} `)).toBe(code)
    expect(normaliseGiftCardCode('GIFT-0000-1111-OOOO')).toBeNull()
    expect(await hashGiftCardCode('a', code)).not.toBe(await hashGiftCardCode('b', code))
  })
})
