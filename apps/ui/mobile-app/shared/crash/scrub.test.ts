import { ApiError } from '../graphql'
import { scrubbed } from './scrub'

// What a crash report may say (card #876): a code or a class and the frames, never a message.

const secrets = ['+91 98765 43210', 'sam@example.com', '1 High St', 'cart-token-abc', '₹1,299.00', 'Sam Rao']

describe('a report’s error', () => {
  it('says an API refusal by its code, whatever its message holds', () => {
    const clean = scrubbed(new ApiError('OUT_OF_STOCK', 'Sam Rao at sam@example.com, +91 98765 43210, cart-token-abc: ₹1,299.00 sold out'))
    expect(clean.message).toBe('OUT_OF_STOCK')
    expect(clean.stack).toContain('OUT_OF_STOCK')
    for (const secret of secrets) expect(`${clean.message}\n${clean.stack}`).not.toContain(secret)
  })

  it('says any other error by its class, and keeps only the frames of its stack', () => {
    const error = new TypeError(`Cannot read ${secrets.join(' ')}`)
    error.stack = `TypeError: Cannot read ${secrets.join(' ')}\nwith a second line of ${secrets[1]}\n    at placeOrder (app:1:2)\n    at press (app:3:4)`
    const clean = scrubbed(error)
    expect(clean.name).toBe('TypeError')
    expect(clean.message).toBe('TypeError')
    expect(clean.stack).toBe('TypeError: TypeError\n    at placeOrder (app:1:2)\n    at press (app:3:4)')
    for (const secret of secrets) expect(`${clean.message}\n${clean.stack}`).not.toContain(secret)
  })

  it('says a thrown string or object by its type, never by its content', () => {
    expect(scrubbed(`phone ${secrets[0]}`).message).toBe('string')
    expect(scrubbed({ email: secrets[1] }).message).toBe('object')
    expect(scrubbed(undefined).message).toBe('undefined')
    expect(`${scrubbed(`phone ${secrets[0]}`).stack}`).not.toContain(secrets[0])
  })
})
