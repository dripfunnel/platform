import type { WebhookDelivery } from '../../../api/settingsDevelopers'
import { durationOf, outcomeOf, scopeName } from './developersView'

const delivery = (over: Partial<WebhookDelivery> = {}): WebhookDelivery => ({ id: 'd1', event: 'order.placed', status: 'delivered', attempts: 1, responseCode: 200, error: null, durationMs: 182, createdAt: '2026-10-10T10:44:00Z', ...over })

describe('what happened to a delivery', () => {
  it('is the server’s code, red when it failed', () => {
    expect(outcomeOf(delivery())).toEqual({ text: '200', failed: false })
    expect(outcomeOf(delivery({ status: 'failed', responseCode: 500 }))).toEqual({ text: '500', failed: true })
  })

  it('names what stopped a delivery that got no answer, and falls back to Failed for a reason it has no words for', () => {
    expect(outcomeOf(delivery({ status: 'failed', responseCode: null, error: 'timeout' }))).toEqual({ text: 'Timed out', failed: true })
    expect(outcomeOf(delivery({ status: 'failed', responseCode: null, error: 'private_address' }))).toEqual({ text: 'Private address', failed: true })
    expect(outcomeOf(delivery({ status: 'failed', responseCode: null, error: 'something_new' }))).toEqual({ text: 'something_new', failed: true })
    expect(outcomeOf(delivery({ status: 'failed', responseCode: null, error: null }))).toEqual({ text: 'Failed', failed: true })
  })

  it('says a delivery still going or held is not a failure', () => {
    expect(outcomeOf(delivery({ status: 'pending', responseCode: null }))).toEqual({ text: 'Sending', failed: false })
    expect(outcomeOf(delivery({ status: 'held', responseCode: null }))).toEqual({ text: 'Waiting', failed: false })
  })
})

describe('how long a delivery took', () => {
  it('is milliseconds under a second and seconds above it, and nothing when unknown', () => {
    expect(durationOf(182)).toBe('182 ms')
    expect(durationOf(1200)).toBe('1.2 s')
    expect(durationOf(10000)).toBe('10 s')
    expect(durationOf(null)).toBeNull()
  })
})

describe('what a key can do', () => {
  it('is in words, and a scope with none shows as the API names it', () => {
    expect(scopeName('orders.read')).toBe('See orders')
    expect(scopeName('gizmos.write')).toBe('gizmos.write')
  })
})
