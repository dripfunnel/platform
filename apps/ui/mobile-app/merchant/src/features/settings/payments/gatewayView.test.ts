import type { Gateway } from '../../../api/settingsPayments'
import { actionsFor, keysComplete, keysOf, standingOf } from './gatewayView'

const gateway = (over: Partial<Gateway> = {}): Gateway => ({ provider: 'razorpay', label: 'Razorpay', kind: 'gateway', live: false, bankDetails: null, connectable: true, connections: [], ...over })
const live = { mode: 'live' as const, live: true, webhookUrl: null }

describe('a way to pay', () => {
  it('is live, test only, not connected, or not set up here, and the last has nothing to press', () => {
    expect(standingOf(gateway({ live: true, connections: [live] }))).toBe('live')
    expect(standingOf(gateway({ connections: [{ ...live, mode: 'test', live: false }] }))).toBe('test')
    expect(standingOf(gateway())).toBe('off')
    expect(standingOf(gateway({ connectable: false }))).toBe('unavailable')
    expect(actionsFor(gateway({ connectable: false }))).toEqual([])
  })

  it('offers connect, then change keys and disconnect once connected, and no keys for Stripe', () => {
    expect(actionsFor(gateway())).toEqual(['connect'])
    expect(actionsFor(gateway({ live: true, connections: [live] }))).toEqual(['changeKeys', 'disconnect'])
    expect(actionsFor(gateway({ provider: 'stripe', label: 'Stripe', live: true, connections: [live] }))).toEqual(['disconnect'])
  })

  it('offers set up for cash on delivery and a bank transfer, and change details only for the bank transfer once on', () => {
    expect(actionsFor(gateway({ provider: 'cod', kind: 'other' }))).toEqual(['setUp'])
    expect(actionsFor(gateway({ provider: 'cod', kind: 'other', live: true }))).toEqual(['turnOff'])
    expect(actionsFor(gateway({ provider: 'bank_transfer', kind: 'other', live: true }))).toEqual(['changeDetails', 'turnOff'])
  })

  it('sends each provider’s own named keys, trimmed, and needs every one', () => {
    const values = { keyId: ' rzp_1 ', keySecret: 's', webhookSecret: 'w', appId: 'ignored' }

    expect(keysOf('razorpay', values)).toEqual({ keyId: 'rzp_1', keySecret: 's', webhookSecret: 'w' })
    expect(keysComplete('razorpay', values)).toBe(true)
    expect(keysComplete('razorpay', { keyId: 'a', keySecret: ' ' })).toBe(false)
    expect(Object.keys(keysOf('phonepe', {}))).toEqual(['clientId', 'clientSecret', 'clientVersion', 'webhookUsername', 'webhookPassword'])
  })
})
