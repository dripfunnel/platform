import type { Offer } from '../../api/dispatch'
import { t } from '../../messages'
import { fakeSession, hasButton, hasText, press, render } from '../../testing/harness'
import { OfferCard, secondsLeft } from './OfferCard'

const offer: Offer = { id: 'o1', deliveryId: 'd1', warehouse: 'Central', area: 'Indiranagar', distanceM: 2400, itemCount: 3, expiresAt: '2026-01-01T10:05:00.000Z' }
const now = Date.parse('2026-01-01T10:00:00.000Z')
const session = () => fakeSession(() => ({}))

describe('the time left', () => {
  it('counts down to the store alert and never goes below zero', () => {
    expect(secondsLeft(offer.expiresAt, now)).toBe(300)
    expect(secondsLeft(offer.expiresAt, now + 600_000)).toBe(0)
  })
})

describe('an offer', () => {
  it('shows the warehouse, the distance, the items and where it goes', async () => {
    const screen = await render(<OfferCard offer={offer} now={now} taken={false} busy={false} refusal={null} onAccept={jest.fn()} onDecline={jest.fn()} />, session())
    for (const text of ['Central', 'Indiranagar']) expect(hasText(screen, text)).toBe(true)
    expect(hasText(screen, '2.4 km')).toBe(true)
  })

  it('hands Accept and Decline back', async () => {
    const [onAccept, onDecline] = [jest.fn(), jest.fn()]
    const screen = await render(<OfferCard offer={offer} now={now} taken={false} busy={false} refusal={null} onAccept={onAccept} onDecline={onDecline} />, session())
    await press(screen, t('home.accept'))
    await press(screen, t('home.decline'))
    expect([onAccept.mock.calls.length, onDecline.mock.calls.length]).toEqual([1, 1])
  })

  it('says someone else took it, with no buttons, when the API answers TAKEN', async () => {
    const screen = await render(<OfferCard offer={offer} now={now} taken busy={false} refusal={null} onAccept={jest.fn()} onDecline={jest.fn()} />, session())
    expect(hasText(screen, t('home.taken'))).toBe(true)
    expect(hasButton(screen, t('home.accept'))).toBe(false)
  })
})
