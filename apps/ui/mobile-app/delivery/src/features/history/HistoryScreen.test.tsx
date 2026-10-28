import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeSession, hasButton, hasText, press, render, texts, type Request } from '../../testing/harness'
import { HistoryScreen } from './HistoryScreen'

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react')
  return { useFocusEffect: (effect: () => void) => useEffect(effect, []) }
})

const past = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  state: 'delivered',
  failedReason: null,
  area: 'Whitefield',
  warehouse: { name: 'Pune godown' },
  deliveredAt: '2026-10-28T10:30:00.000Z',
  failedAt: null,
  feeAmount: '4900',
  currency: 'INR',
  ...over,
})
const page = (nodes: unknown[], endCursor: string | null, hasNextPage: boolean, counts = { deliveredToday: 3, deliveredThisWeek: 12 }) => ({
  deliveries: { ...counts, nodes, pageInfo: { startCursor: null, endCursor, hasPreviousPage: false, hasNextPage } },
})

const sent: Request[] = []
let first: () => unknown
let next: () => unknown
const answer = (request: Request): unknown => {
  sent.push(request)
  return request.variables?.['after'] ? next() : first()
}

// The first render loads react-native's lazy modules cold, over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  first = () => page([], null, false)
  await render(<HistoryScreen />, fakeSession(answer))
}, 120_000)

beforeEach(() => {
  sent.length = 0
  first = () => page([past('d-1')], null, false)
  next = () => page([], null, false)
})

describe('History', () => {
  it('asks for delivered and failed deliveries, 20 at a time, and never for the customer', async () => {
    await render(<HistoryScreen />, fakeSession(answer))
    expect(sent[0]?.variables).toMatchObject({ state: ['delivered', 'failed'], first: 20, after: null })
    expect(sent[0]?.query).not.toContain('customer')
    expect(sent[0]?.query).not.toContain('cashDueAmount')
  })

  it('shows today’s and this week’s counts, then each delivery with its result, route and the fee the customer paid', async () => {
    first = () =>
      page(
        [
          past('d-1'),
          past('d-2', { state: 'failed', failedReason: 'no_one_home', deliveredAt: null, failedAt: '2026-10-27T09:00:00.000Z', feeAmount: '0' }),
          past('d-3', { state: 'failed', failedReason: 'recalled', deliveredAt: null, failedAt: '2026-10-26T09:00:00.000Z', feeAmount: null, area: null }),
        ],
        null,
        false,
      )
    const screen = await render(<HistoryScreen />, fakeSession(answer))
    expect(texts(screen).slice(0, 6)).toEqual([t('history.today'), '3', t('history.delivered'), t('history.thisWeek'), '12', t('history.delivered')])
    expect(hasText(screen, t('history.result.delivered'))).toBe(true)
    expect(hasText(screen, t('history.result.notDelivered'))).toBe(true)
    expect(hasText(screen, t('history.result.recalled'))).toBe(true)
    expect(hasText(screen, t('history.route', { warehouse: 'Pune godown', area: 'Whitefield' }))).toBe(true)
    expect(hasText(screen, t('history.fee', { amount: '₹49.00' }))).toBe(true)
    expect(texts(screen).filter((text) => text === t('history.freeDelivery'))).toHaveLength(2)
  })

  it('loads the next 20 from the cursor on Show more, and stops offering it at the end', async () => {
    first = () => page([past('d-1')], 'c1', true)
    next = () => page([past('d-2', { area: 'Koramangala' })], null, false)
    const screen = await render(<HistoryScreen />, fakeSession(answer))
    await press(screen, t('history.showMore'))
    expect(sent[1]?.variables).toMatchObject({ after: 'c1' })
    expect(hasText(screen, 'Koramangala')).toBe(true)
    expect(hasText(screen, 'Whitefield')).toBe(true)
    expect(hasButton(screen, t('history.showMore'))).toBe(false)
  })

  it('says so when the next page cannot be loaded, and loads it on the next try', async () => {
    first = () => page([past('d-1')], 'c1', true)
    let tries = 0
    next = () => {
      tries += 1
      if (tries === 1) throw new Error('no signal')
      return page([past('d-2', { area: 'Koramangala' })], null, false)
    }
    const screen = await render(<HistoryScreen />, fakeSession(answer))
    await press(screen, t('history.showMore'))
    expect(hasText(screen, t('history.showMoreFailed'))).toBe(true)
    await press(screen, t('history.showMore'))
    expect(hasText(screen, t('history.showMoreFailed'))).toBe(false)
    expect(hasText(screen, 'Koramangala')).toBe(true)
  })

  it('says there are no deliveries yet', async () => {
    first = () => page([], null, false, { deliveredToday: 0, deliveredThisWeek: 0 })
    const screen = await render(<HistoryScreen />, fakeSession(answer))
    expect(hasText(screen, t('history.emptyTitle'))).toBe(true)
  })

  it('says so with no signal, and loads again on Try again', async () => {
    let tries = 0
    first = () => {
      tries += 1
      if (tries === 1) throw new ApiError('NO_RESPONSE', 'offline')
      return page([past('d-1')], null, false)
    }
    const screen = await render(<HistoryScreen />, fakeSession(answer))
    expect(hasText(screen, t('states.offline.title'))).toBe(true)
    await press(screen, t('common.retry'))
    expect(hasText(screen, t('history.result.delivered'))).toBe(true)
  })

  it('says something went wrong when the API refuses', async () => {
    first = () => {
      throw new ApiError('UNKNOWN', 'x')
    }
    const screen = await render(<HistoryScreen />, fakeSession(answer))
    expect(hasText(screen, t('states.error.title'))).toBe(true)
  })
})
