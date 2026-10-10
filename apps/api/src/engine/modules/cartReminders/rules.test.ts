import { describe, expect, it } from 'vitest'
import { levelOf, mayEmail, quietWaitMs, settingsSchema, skipReasonOf, type DecisionFacts } from './rules'

const sendable: DecisionFacts = {
  byHand: false, storeSending: true, flowEnabled: true, levelAllows: true, stepEnabled: true, cartOpen: true, stopped: false, recovered: false,
  contact: 'asha@example.com', mayContact: true, suppressed: false, skipOutOfStock: true, allOutOfStock: false, underMinimum: false, weeklyCap: true, remindedAnotherCart: false,
}

describe('skipReasonOf', () => {
  it('sends when nothing stands in the way', () => {
    expect(skipReasonOf(sendable)).toBeNull()
  })

  it('answers in the prototype’s order: recovered › stopped › no contact › opted out › out of stock › under minimum', () => {
    const all = { ...sendable, recovered: true, stopped: true, contact: null, mayContact: false, allOutOfStock: true, underMinimum: true }
    expect(skipReasonOf(all)).toBe('recovered')
    expect(skipReasonOf({ ...all, recovered: false })).toBe('stopped')
    expect(skipReasonOf({ ...all, recovered: false, stopped: false })).toBe('no_contact')
    expect(skipReasonOf({ ...all, recovered: false, stopped: false, contact: 'a@b.example' })).toBe('opted_out')
    expect(skipReasonOf({ ...sendable, allOutOfStock: true, underMinimum: true })).toBe('out_of_stock')
    expect(skipReasonOf({ ...sendable, underMinimum: true })).toBe('under_minimum')
  })

  it('holds the store and the plan to automatic sends only; one sent by hand answers only the shopper’s side', () => {
    for (const off of [{ storeSending: false }, { flowEnabled: false }, { levelAllows: false }, { stepEnabled: false }]) {
      expect(skipReasonOf({ ...sendable, ...off })).toBe('paused')
      expect(skipReasonOf({ ...sendable, ...off, byHand: true })).toBeNull()
    }
    expect(skipReasonOf({ ...sendable, byHand: true, allOutOfStock: true, underMinimum: true, remindedAnotherCart: true })).toBeNull()
    expect(skipReasonOf({ ...sendable, byHand: true, mayContact: false })).toBe('opted_out')
    expect(skipReasonOf({ ...sendable, byHand: true, suppressed: true })).toBe('undeliverable')
  })

  it('caps a shopper at one cart a week only when the cap is on, and never a cart with stock left or out of stock not skipped', () => {
    expect(skipReasonOf({ ...sendable, remindedAnotherCart: true })).toBe('weekly_cap')
    expect(skipReasonOf({ ...sendable, remindedAnotherCart: true, weeklyCap: false })).toBeNull()
    expect(skipReasonOf({ ...sendable, allOutOfStock: true, skipOutOfStock: false })).toBeNull()
    expect(skipReasonOf({ ...sendable, cartOpen: false, recovered: true })).toBe('cart_gone')
  })
})

describe('quietWaitMs', () => {
  it('holds from 9 pm until 8 am, and nothing in the day', () => {
    expect(quietWaitMs(21 * 60)).toBe(11 * 3_600_000)
    expect(quietWaitMs(23 * 60 + 30)).toBe(8.5 * 3_600_000)
    expect(quietWaitMs(7 * 60 + 59)).toBe(60_000)
    expect(quietWaitMs(8 * 60)).toBe(0)
    expect(quietWaitMs(20 * 60 + 59)).toBe(0)
  })
})

describe('mayEmail', () => {
  it('never after a stop or a no, elsewhere unless they said so', () => {
    expect(mayEmail('IN', null)).toBe(true)
    expect(mayEmail('US', { consent_state: 'not_asked', consent_channels: [] })).toBe(true)
    expect(mayEmail('US', { consent_state: 'stopped', consent_channels: [] })).toBe(false)
    expect(mayEmail('IN', { consent_state: 'declined', consent_channels: [] })).toBe(false)
  })

  it('in the EU and EEA only once they agreed to email', () => {
    expect(mayEmail('DE', null)).toBe(false)
    expect(mayEmail('NO', { consent_state: 'opted_in', consent_channels: ['whatsapp'] })).toBe(false)
    expect(mayEmail('FR', { consent_state: 'opted_in', consent_channels: ['email'] })).toBe(true)
  })
})

describe('levelOf', () => {
  it('reads the plan’s index, and anything out of range as its nearest', () => {
    expect([levelOf(0), levelOf(1), levelOf(2), levelOf(7), levelOf(-1)]).toEqual(['youSend', 'onePerCart', 'automatic', 'automatic', 'youSend'])
  })
})

describe('settingsSchema', () => {
  const step = (position: number, delayMinutes: number) => ({ position, enabled: true, delayMinutes, channel: 'email', subject: 'Hi', body: '', discountPercent: null })
  const input = (steps: unknown[]) => ({ enabled: true, minimum: null, skipOutOfStock: true, quietHours: true, weeklyCap: true, steps })

  it('takes three steps, each later than the one on before it; a step that is off doesn’t count', () => {
    expect(settingsSchema.safeParse(input([step(1, 60), step(2, 1440), step(3, 4320)])).success).toBe(true)
    expect(settingsSchema.safeParse(input([step(1, 60), { ...step(2, 30), enabled: false }, step(3, 240)])).success).toBe(true)
    expect(settingsSchema.safeParse(input([step(1, 60), step(2, 60), step(3, 4320)])).success).toBe(false)
    expect(settingsSchema.safeParse(input([step(1, 60), step(1, 1440), step(3, 4320)])).success).toBe(false)
  })

  it('refuses a field it doesn’t know', () => {
    expect(settingsSchema.safeParse({ ...input([step(1, 60), step(2, 1440), step(3, 4320)]), storeId: 'x' }).success).toBe(false)
  })
})
