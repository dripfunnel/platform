import { act } from 'react-test-renderer'
import { actingAs, fakeClient, hasText, press, pressableNamed, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SalesScreen } from './SalesScreen'
import { TeamScreen } from './TeamScreen'
import { access, ApiError, asked, click, clickLast, mockSession, page, settle, show, supplierSeat, tiers, type, type Handlers } from './testKit'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockShare = jest.fn<Promise<boolean>, [string, string]>(async () => true)

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../common/shareCsv', () => ({ shareCsv: (title: string, csv: string) => mockShare(title, csv) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

type Json = Record<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

const sale = (lineId: string, orderNumber: string, over: Json = {}) => ({
  lineId,
  orderNumber,
  placedAt: '2026-10-04T06:10:00Z',
  orderState: 'placed',
  name: 'Mara Linen Shirt',
  versionName: 'M',
  quantity: 1,
  refundedQuantity: 0,
  amount: { amount: '269900', currency: 'INR' },
  ...over,
})

const salesHandlers = (nodes: unknown[], more: Handlers = {}, permissions = tiers.ordersRead): Handlers => ({
  'acting { permissions': () => access(permissions),
  'acting { seller { name': () => ({ me: { acting: { seller: { name: 'Northwind Textiles' } } } }),
  mySales: () => ({ mySales: page(nodes) }),
  ...more,
})

const showSales = (handlers: Handlers, tier: Parameters<typeof supplierSeat>[0] = 'ordersRead') => show(<SalesScreen />, handlers, { acting: supplierSeat(tier) })

describe('Your sales', () => {
  it('lists the supplier’s own sold lines at the price sold, with how each stands, and no total', async () => {
    const { renderer } = await showSales(
      salesHandlers([
        sale('l1', 'KT-1049'),
        sale('l2', 'KT-1046', { name: 'Linen Tote', versionName: null, quantity: 2, refundedQuantity: 1, amount: { amount: '349900', currency: 'INR' } }),
        sale('l3', 'KT-1041', { refundedQuantity: 1 }),
        sale('l4', 'KT-1037', { orderState: 'cancelled' }),
      ]),
    )

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['Your sales', 'Lines with Northwind Textiles’s products in Juniper & Co.. Dates are in UTC.', 'KT-1049', 'Mara Linen Shirt · M', '₹2,699.00', 'Sold', 'Linen Tote', '₹3,499.00', '1 of 2 refunded', 'Refunded', 'Cancelled']),
    )
    expect(texts(renderer).filter((text) => text.includes('₹'))).toHaveLength(4)
    expect(hasText(renderer, 'so there are no payouts here')).toBe(true)
  })

  it('pages by the API’s cursor with Show more, and says when there is nothing yet', async () => {
    const { renderer, calls } = await showSales({
      ...salesHandlers([]),
      mySales: (variables) => ({ mySales: variables.after === null ? page([sale('l1', 'KT-1049')], 'c1') : page([sale('l2', 'KT-1046')]) }),
    })
    expect(hasText(renderer, 'KT-1049')).toBe(true)
    await click(renderer, 'Show more')
    expect(asked(calls, 'mySales').at(-1)?.variables.after).toBe('c1')
    expect(hasText(renderer, 'KT-1046')).toBe(true)
    expect(hasText(renderer, 'Show more')).toBe(false)

    const empty = await showSales(salesHandlers([]))
    expect(hasText(empty.renderer, 'No sales here yet')).toBe(true)
    expect(hasText(empty.renderer, 'Export CSV')).toBe(false)
  })

  it('exports the supplier’s own orders and hands the file to the share sheet', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await showSales(
        salesHandlers([sale('l1', 'KT-1049')], { exportOrders: () => ({ exportOrders: 'job-1' }), orderExport: () => ({ orderExport: { id: 'job-1', state: 'done', rows: 1, truncated: false, csv: 'order,line\nKT-1049,2699.00\n', expiresAt: null } }) }),
      )
      await click(renderer, 'Export CSV')
      await act(async () => void (await jest.advanceTimersByTimeAsync(1600)))
      await settle()
      expect(asked(calls, 'exportOrders')[0]?.variables).toEqual({ filter: 'ALL', search: null })
      expect(mockShare).toHaveBeenCalledWith('Orders export', 'order,line\nKT-1049,2699.00\n')
    } finally {
      jest.useRealTimers()
    }
  })

  it('tells every seat without sales.read it has no access, and asks for no sales', async () => {
    for (const tier of ['stock', 'catalogue'] as const) {
      const { renderer, calls } = await showSales(salesHandlers([sale('l1', 'KT-1049')], {}, tiers[tier]), tier)
      expect(hasText(renderer, 'You don’t have access to your sales')).toBe(true)
      expect(asked(calls, 'mySales')).toEqual([])
    }
    const merchant = await show(<SalesScreen />, { ...salesHandlers([sale('l1', 'KT-1049')]), 'acting { permissions': () => access(['orders.read', 'reports.read'], null) }, { acting: actingAs('owner') })
    expect(hasText(merchant.renderer, 'KT-1049')).toBe(false)
    expect(asked(merchant.calls, 'mySales')).toEqual([])
  })

  it('says it could not load, and tries again', async () => {
    let failing = true
    const { renderer } = await showSales({
      ...salesHandlers([sale('l1', 'KT-1049')]),
      mySales: () => {
        if (failing) throw new ApiError('NO_RESPONSE', 'down')
        return { mySales: page([sale('l1', 'KT-1049')]) }
      },
    })
    expect(hasText(renderer, 'We couldn’t load your sales')).toBe(true)
    failing = false
    await click(renderer, 'Try again')
    expect(hasText(renderer, 'KT-1049')).toBe(true)
  })
})

const person = (id: string, over: Json = {}) => ({ id, kind: 'member', name: null, email: `${id}@northwind.example`, role: 'supplier-member', you: false, lastAdmin: false, since: '2026-09-02T09:00:00Z', expiresAt: null, expired: false, ...over })
const nadia = person('m-nadia', { email: 'nadia@northwind.example', name: 'Nadia Tran', role: 'supplier-admin', you: true, lastAdmin: true })
const leo = person('m-leo', { email: 'leo@northwind.example', name: 'Leo Park' })
const mira = person('i-mira', { email: 'mira@northwind.example', kind: 'invitation', expiresAt: '2026-10-15T09:00:00Z' })

const teamHandlers = (people: unknown[], more: Handlers = {}, permissions = [...tiers.ordersFulfil, 'supplier.team']): Handlers => ({
  'acting { permissions': () => access(permissions),
  'acting { seller { name': () => ({ me: { acting: { seller: { name: 'Northwind Textiles' } } } }),
  mySupplierTeam: () => ({ mySupplierTeam: page(people) }),
  ...more,
})

const showTeam = (handlers: Handlers, admin = true) => show(<TeamScreen />, handlers, { acting: supplierSeat('ordersFulfil', admin) })

describe('Your team', () => {
  it('lists the supplier’s people and invitations for a Supplier admin', async () => {
    const { renderer } = await showTeam(teamHandlers([nadia, leo, mira]))

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['Your team', 'The people from Northwind Textiles who work in Juniper & Co..', 'Nadia Tran', 'Active · you', 'Leo Park', 'leo@northwind.example', 'Active', 'mira@northwind.example', 'Invited · not accepted yet', 'Supplier admin', 'Supplier member']),
    )
    expect(hasText(renderer, 'Invite someone')).toBe(true)
  })

  it('is absent for a seat without supplier.team, which asks for no team', async () => {
    const { renderer, calls } = await showTeam(teamHandlers([nadia, leo], {}, tiers.ordersFulfil), false)
    expect(hasText(renderer, 'You don’t have access to your team')).toBe(true)
    expect(hasText(renderer, 'Leo Park')).toBe(false)
    expect(hasText(renderer, 'Invite someone')).toBe(false)
    expect(asked(calls, 'mySupplierTeam')).toEqual([])
  })

  it('invites by email with the role chosen, saying "sent" for any address', async () => {
    const { renderer, calls } = await showTeam(teamHandlers([nadia], { inviteSupplierUser: () => ({ inviteSupplierUser: 'i-1' }) }))

    expect(hasText(renderer, 'It’s just you so far. Invite someone from Northwind Textiles to share the work.')).toBe(true)
    await click(renderer, 'Invite someone')
    expect(hasText(renderer, 'Supplier member — Products, stock and their orders')).toBe(true)
    await type(renderer, 'Their email', 'not an email')
    await clickLast(renderer, 'Send invitation')
    expect(hasText(renderer, 'Enter an email like name@example.com.')).toBe(true)
    expect(asked(calls, 'inviteSupplierUser')).toEqual([])

    await type(renderer, 'Their email', 'asha@northwind.example')
    await press(pressableNamed(renderer, 'Supplier admin — also invites and removes people'))
    await clickLast(renderer, 'Send invitation')
    expect(asked(calls, 'inviteSupplierUser')[0]?.variables).toEqual({ e: 'asha@northwind.example', r: 'supplier-admin' })
    expect(hasText(renderer, 'Invitation sent to asha@northwind.example')).toBe(true)
  })

  it('explains why the last admin can’t change or leave, and offers nothing to do', async () => {
    const { renderer, calls } = await showTeam(teamHandlers([nadia, leo]))
    await click(renderer, 'Options for Nadia Tran')
    expect(hasText(renderer, 'This is the last admin, so the role can’t change and they can’t be removed.')).toBe(true)
    expect(hasText(renderer, 'Remove from Northwind Textiles')).toBe(false)
    expect(asked(calls, 'changeSupplierRole')).toEqual([])
  })

  it('makes a member an admin, then removes someone after saying they lose access at once', async () => {
    const people = [nadia, leo]
    const { renderer, calls } = await showTeam(
      teamHandlers(people, { changeSupplierRole: () => ({ changeSupplierRole: true }), removeSupplierUser: () => ({ removeSupplierUser: true }) }),
    )

    await click(renderer, 'Options for Leo Park')
    await click(renderer, 'Make admin')
    await clickLast(renderer, 'Make admin')
    expect(asked(calls, 'changeSupplierRole')[0]?.variables).toEqual({ id: 'm-leo', r: 'supplier-admin' })
    expect(hasText(renderer, 'Leo Park is now an admin')).toBe(true)

    await click(renderer, 'Options for Leo Park')
    await click(renderer, 'Remove from Northwind Textiles')
    expect(hasText(renderer, 'They lose access to Juniper & Co. straight away. Their own account stays.')).toBe(true)
    await clickLast(renderer, 'Remove')
    expect(asked(calls, 'removeSupplierUser')[0]?.variables).toEqual({ id: 'm-leo' })
    expect(hasText(renderer, 'Leo Park removed')).toBe(true)
  })

  it('resends and cancels an invitation, and keeps a refusal such as LAST_ADMIN in the sheet that asked', async () => {
    const { renderer, calls } = await showTeam(
      teamHandlers([nadia, leo, mira], {
        resendSupplierInvitation: () => ({ resendSupplierInvitation: 'i-mira' }),
        revokeSupplierInvitation: () => ({ revokeSupplierInvitation: true }),
        removeSupplierUser: () => {
          throw new ApiError('LAST_ADMIN', 'no')
        },
      }),
    )

    await click(renderer, 'Options for mira@northwind.example')
    await click(renderer, 'Resend invitation')
    await clickLast(renderer, 'Send again')
    expect(asked(calls, 'resendSupplierInvitation')[0]?.variables).toEqual({ id: 'i-mira' })
    expect(hasText(renderer, 'Invitation sent again to mira@northwind.example')).toBe(true)

    await click(renderer, 'Options for mira@northwind.example')
    await click(renderer, 'Cancel invitation')
    await clickLast(renderer, 'Cancel invitation')
    expect(asked(calls, 'revokeSupplierInvitation')[0]?.variables).toEqual({ id: 'i-mira' })

    await click(renderer, 'Options for Leo Park')
    await click(renderer, 'Remove from Northwind Textiles')
    await clickLast(renderer, 'Remove')
    expect(hasText(renderer, 'This is the last admin, so the role can’t change and they can’t be removed. Make someone else an admin first.')).toBe(true)
    expect(hasText(renderer, 'Leo Park removed')).toBe(false)
  })

  it('lists but changes nothing while the store is read-only', async () => {
    const readOnly = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }
    const { renderer } = await show(<TeamScreen />, teamHandlers([nadia, leo]), { acting: supplierSeat('ordersFulfil', true), client: fakeClient({ state: readOnly }) })
    expect(hasText(renderer, 'Leo Park')).toBe(true)
    expect(hasText(renderer, 'Invite someone')).toBe(false)
    expect(hasText(renderer, 'Your team can’t change while this store is read-only.')).toBe(true)
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Options for Leo Park' && typeof node.props.onPress === 'function')).toHaveLength(0)
  })
})
