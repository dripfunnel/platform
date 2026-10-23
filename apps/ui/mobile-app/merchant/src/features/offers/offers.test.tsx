import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { shareCsv } from '../common/shareCsv'
import { resetScenario } from '../states/scenario'
import { OfferEditorScreen } from './editor/OfferEditorScreen'
import { blankAction, blankCondition, noTargets } from './offerDraft'
import { OfferScreen } from './OfferScreen'
import { OffersScreen } from './OffersScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => undefined }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))
jest.mock('../common/shareCsv', () => ({ shareCsv: jest.fn(async () => true) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

const owner = ['offers.read', 'offers.write', 'offers.export']
const staff = ['offers.read']
const access = (permissions: string[], seller: { id: string } | null = null) => ({ me: { acting: { permissions, seller } } })
const paged = <T,>(nodes: T[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: next !== null, hasPreviousPage: false, startCursor: null, endCursor: next } })
const inr = (amount: string) => ({ amount, currency: 'INR' })
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const apiOffer = (over: Record<string, unknown> = {}) => ({
  id: 'o-1',
  name: 'Welcome 10% off',
  internalName: null,
  description: null,
  trigger: 'code',
  code: 'WELCOME10',
  status: 'live',
  enabled: true,
  startsAt: null,
  endsAt: null,
  totalUsesLimit: null,
  perCustomerLimit: 1,
  usesCount: 112,
  combines: { product: false, order: false, shipping: false },
  conditions: [blankCondition({ operation: 'first_order' })],
  action: blankAction({ operation: 'order_percentage_discount', percent: 10 }),
  revision: 3,
  ...over,
})
const freeDelivery = apiOffer({
  id: 'o-2',
  name: 'Free delivery over ₹999',
  trigger: 'automatic',
  code: null,
  usesCount: 264,
  perCustomerLimit: null,
  conditions: [blankCondition({ operation: 'minimum_order_amount', amounts: [inr('99900')] })],
  action: blankAction({ operation: 'free_shipping' }),
})
const limited = apiOffer({ id: 'o-3', name: 'Flash 50% off silk', code: 'FLASH50', status: 'used_up', totalUsesLimit: 50, usesCount: 50, conditions: [], action: blankAction({ operation: 'products_percentage_discount', percent: 50, targets: { ...noTargets, productIds: ['p-8'] } }) })
const singleUse = apiOffer({ id: 'o-4', name: 'Instagram single-use 15%', code: null, conditions: [], action: blankAction({ operation: 'order_percentage_discount', percent: 15 }) })

const place = { timeZone: 'Asia/Kolkata', country: 'IN' }
const counts = { live: 2, scheduled: 1, off: 0, ended: 1 }
const groups = [
  { id: 'g-1', name: 'VIP', description: null, members: 12 },
  { id: 'g-2', name: 'Wholesale', description: null, members: 5 },
]

// An answer that has not come yet; releasing it at the end of a test lets the client's own timeout timer clear.
const held = <T,>(answer: T) => {
  let release: () => void = () => undefined
  const promise = new Promise<T>((resolve) => (release = () => resolve(answer)))
  return { promise, release }
}

const base = (over: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(owner),
  'query Offers(': () => ({ offers: paged([apiOffer(), freeDelivery]) }),
  '{ offerCounts': () => ({ offerCounts: counts }),
  'query Offer(': () => ({ offer: apiOffer() }),
  storeLocale: () => ({ storeInfo: place, storeLocale: { pricingCurrency: 'INR', currencies: [{ code: 'INR', status: 'active' }], rates: [] } }),
  '{ storeInfo { timeZone country } }': () => ({ storeInfo: place }),
  'query Collections(': () => ({ collections: paged([{ id: 'c-1', name: 'Summer edit', kind: 'manual', visible: true, parentId: null, inheritParent: false, match: 'all', rules: [], products: 24, computedAt: null }]) }),
  'query Filters(': () => ({ facets: paged([{ id: 'f-1', name: 'Fabric', position: 0, revision: 1, shopperVisible: true, values: [{ id: 'fv-1', name: 'Linen', products: 9 }] }]) }),
  '{ customerGroups': () => ({ customerGroups: groups }),
  'query Markets(': () => ({ markets: paged([]) }),
  'query Names(': () => ({}),
  'query Batches(': () => ({ offerCodeBatches: paged([]) }),
  ...over,
})

const show = async (element: ReactElement, handlers: Handlers, options: Options = {}) => {
  const { client, calls } = fakeApi(handlers)
  mockSession.client = client
  const renderer = await renderShell(element, options)
  await settle()
  return { renderer, calls }
}

const input = (renderer: ReactTestRenderer, label: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  return found
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  await act(async () => input(renderer, label).props.onChangeText(value))
}
const click = async (renderer: ReactTestRenderer, label: string, nth = 0) => {
  const found = pressablesNamed(renderer, label)
  const target = nth < 0 ? found.at(nth) : found[nth]
  if (!target) throw new Error(`nothing to press named "${label}"`)
  await press(target)
  await settle()
}
/** A choice row (a label and a sub-line), found by its label. */
const choose = async (renderer: ReactTestRenderer, label: string) => {
  const found = renderer.root.findAll((node) => node.props.label === label && typeof node.props.onPress === 'function')[0]
  if (!found) throw new Error(`no choice named "${label}"`)
  await press(found)
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const hasButton = (renderer: ReactTestRenderer, label: string) => pressablesNamed(renderer, label).length > 0
const hasField = (renderer: ReactTestRenderer, label: string) => renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function').length > 0

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the Offers list', () => {
  it('lists each offer with its status, what it gives, its code or Automatic, and its uses, and the tabs’ counts', async () => {
    const { renderer } = await show(<OffersScreen />, base({ 'query Offers(': () => ({ offers: paged([apiOffer(), freeDelivery, limited]) }) }))

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['Welcome 10% off', '10% off the order', 'WELCOME10', '112 uses', 'Free delivery over ₹999', 'Free delivery · over ₹999.00', 'Automatic', '264 uses', 'Flash 50% off silk', 'Used up', '50 / 50']),
    )
    expect(hasButton(renderer, 'Live, 2')).toBe(true)
    expect(hasButton(renderer, 'Scheduled, 1')).toBe(true)
    expect(hasButton(renderer, 'Ended, 1')).toBe(true)
    await press(pressableNamed(renderer, 'Open Welcome 10% off'))
    expect(mockPush).toHaveBeenCalledWith('/offers/o-1')
  })

  it('asks the API for the tab, the type and how shoppers get it, and for the search after typing stops', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await show(<OffersScreen />, base())
      expect(asked(calls, 'query Offers(').at(-1)?.variables).toMatchObject({ status: 'live', kind: null, trigger: null, search: null })

      await click(renderer, 'Ended, 1')
      expect(asked(calls, 'query Offers(').at(-1)?.variables).toMatchObject({ status: 'ended' })
      await click(renderer, 'Money off the order')
      await click(renderer, 'Codes only')
      expect(asked(calls, 'query Offers(').at(-1)?.variables).toMatchObject({ status: 'ended', kind: 'order', trigger: 'code' })

      await act(async () => input(renderer, 'Search offers').props.onChangeText('welcome'))
      expect(asked(calls, 'query Offers(').at(-1)?.variables).toMatchObject({ search: null })
      await act(async () => void jest.advanceTimersByTime(400))
      await settle()
      expect(asked(calls, 'query Offers(').at(-1)?.variables).toMatchObject({ search: 'welcome', kind: 'order', trigger: 'code' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('pages with Show more', async () => {
    const seen: Array<string | null> = []
    const { renderer } = await show(
      <OffersScreen />,
      base({
        'query Offers(': (variables) => {
          seen.push(variables.after as string | null)
          return { offers: variables.after ? paged([apiOffer({ id: 'o-9', name: 'Second page offer' })]) : paged([apiOffer({ name: 'First page offer' })], 'cursor-1') }
        },
      }),
    )

    await click(renderer, 'Show more')
    expect(seen).toEqual([null, 'cursor-1'])
    expect(texts(renderer)).toEqual(expect.arrayContaining(['First page offer', 'Second page offer']))
  })

  it('draws a skeleton while it loads', async () => {
    const pending = held({ offers: paged([]) })
    const { renderer } = await show(<OffersScreen />, base({ 'query Offers(': () => pending.promise }))

    expect(renderer.root.findAll((node) => node.props.accessibilityRole === 'progressbar').length).toBeGreaterThan(0)
    expect(hasText(renderer, 'Welcome 10% off')).toBe(false)
    await act(async () => pending.release())
    await settle()
  })

  it('says it could not load, and asks again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(
      <OffersScreen />,
      base({
        'query Offers(': () => {
          if (fail) throw new ApiError('NO_RESPONSE', 'x')
          return { offers: paged([apiOffer()]) }
        },
      }),
    )

    expect(hasText(renderer, 'We couldn’t load Offers')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, 'query Offers(')).toHaveLength(2)
    expect(hasText(renderer, 'Welcome 10% off')).toBe(true)
  })

  it('is access denied to a supplier, which reads nothing but its own permissions', async () => {
    const { renderer, calls } = await show(<OffersScreen />, base({ 'acting { permissions': () => access([], { id: 'supplier-1' }) }), { acting: actingAs('supplier-admin', 'vendor-orders-fulfil') })

    expect(hasText(renderer, 'You don’t have access to Offers')).toBe(true)
    expect(calls.map((call) => call.query).filter((query) => query.includes('ffer'))).toEqual([])
  })

  it('shows a store with no offers the first-time panel, with the four kinds to start from', async () => {
    const { renderer } = await show(<OffersScreen />, base({ 'query Offers(': () => ({ offers: paged([]) }), '{ offerCounts': () => ({ offerCounts: { live: 0, scheduled: 0, off: 0, ended: 0 } }) }))

    expect(hasText(renderer, 'No offers yet')).toBe(true)
    expect(hasField(renderer, 'Search offers')).toBe(false)
    await press(pressableNamed(renderer, 'Buy X, get Y'))
    expect(mockPush).toHaveBeenCalledWith('/offers/new?type=bxgy')
  })

  it('says nothing is live when nothing is', async () => {
    const { renderer } = await show(<OffersScreen />, base({ 'query Offers(': () => ({ offers: paged([]) }) }))

    expect(hasText(renderer, 'No live offers')).toBe(true)
    expect(hasField(renderer, 'Search offers')).toBe(true)
  })

  it('says nobody matches when a filter finds no offers, and clears the filters', async () => {
    const { renderer } = await show(<OffersScreen />, base({ 'query Offers(': () => ({ offers: paged([]) }) }))

    await click(renderer, 'Codes only')
    expect(hasText(renderer, 'No offers match')).toBe(true)
    await click(renderer, 'Clear filters')
    expect(hasText(renderer, 'No live offers')).toBe(true)
  })

  it('gives the Owner Create offer and each row its actions; Staff gets neither, and is told it is view only', async () => {
    const { renderer } = await show(<OffersScreen />, base())
    expect(hasButton(renderer, '+ Create offer')).toBe(true)
    await press(pressableNamed(renderer, '+ Create offer'))
    expect(mockPush).toHaveBeenCalledWith('/offers/new')

    await click(renderer, 'Actions for Welcome 10% off')
    expect(['Edit', 'Open', 'Share code', 'Turn off', 'End now', 'Duplicate', 'Delete'].map((label) => hasButton(renderer, label))).toEqual([true, true, true, true, true, true, true])
  })

  it('shows Staff the list read-only: no Create, no Edit, no actions, only Open and Share code', async () => {
    const { renderer } = await show(<OffersScreen />, base({ 'acting { permissions': () => access(staff) }), { acting: actingAs('staff') })

    expect(hasText(renderer, 'View only.')).toBe(true)
    expect(hasButton(renderer, '+ Create offer')).toBe(false)
    await click(renderer, 'Actions for Welcome 10% off')
    expect(['View', 'Share code'].map((label) => hasButton(renderer, label))).toEqual([true, true])
    expect(['Edit', 'Turn off', 'End now', 'Duplicate', 'Delete'].some((label) => hasButton(renderer, label))).toBe(false)
  })

  it('looks only when the store is read-only: no Create, and it says why', async () => {
    const { renderer } = await show(<OffersScreen />, base(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is view-only. Offers can’t be changed until billing is sorted.')).toBe(true)
    expect(hasButton(renderer, '+ Create offer')).toBe(false)
  })

  it('turns an offer off only after saying what that does, and refreshes the list', async () => {
    const { renderer, calls } = await show(<OffersScreen />, base({ 'mutation PauseOffer(': () => ({ pauseOffer: true }) }))

    await click(renderer, 'Actions for Welcome 10% off')
    await click(renderer, 'Turn off')
    expect(hasText(renderer, 'Turn off Welcome 10% off?')).toBe(true)
    expect(asked(calls, 'mutation PauseOffer(')).toHaveLength(0)

    await click(renderer, 'Turn off', -1)
    expect(asked(calls, 'mutation PauseOffer(')[0]?.variables).toEqual({ id: 'o-1' })
    expect(asked(calls, 'query Offers(')).toHaveLength(2)
  })

  it('keeps a refusal in words, by its code, when an act is refused', async () => {
    const { renderer } = await show(<OffersScreen />, base({ 'mutation EndOffer(': () => { throw new ApiError('READ_ONLY', 'x') } }))

    await click(renderer, 'Actions for Welcome 10% off')
    await click(renderer, 'End now')
    await click(renderer, 'End now', -1)
    expect(hasText(renderer, 'Your store is view-only, so offers can’t be changed.')).toBe(true)
  })

  it('opens the copy a Duplicate makes', async () => {
    const { renderer, calls } = await show(<OffersScreen />, base({ 'mutation DuplicateOffer(': () => ({ duplicateOffer: 'o-copy' }) }))

    await click(renderer, 'Actions for Welcome 10% off')
    await click(renderer, 'Duplicate')
    expect(asked(calls, 'mutation DuplicateOffer(')[0]?.variables).toEqual({ id: 'o-1' })
    expect(mockPush).toHaveBeenCalledWith('/offers/o-copy')
  })
})

describe('one offer', () => {
  it('words the offer in a sentence and its details, and shows the shared code', async () => {
    const { renderer } = await show(<OfferScreen id="o-1" />, base())

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['Welcome 10% off', 'Live', 'Share the code', 'WELCOME10', 'Share code', 'Details', 'Money off the order', 'With a coupon code', 'First order only', 'Unlimited', 'No other offers']),
    )
    expect(hasText(renderer, '10% off the whole order · code WELCOME10 · first order only')).toBe(true)
    expect(hasButton(renderer, 'Edit')).toBe(true)
    expect(hasButton(renderer, 'More actions')).toBe(true)
  })

  it('gives Staff the page and nothing to change: no Edit, no actions', async () => {
    const { renderer } = await show(<OfferScreen id="o-1" />, base({ 'acting { permissions': () => access(staff) }), { acting: actingAs('staff') })

    expect(hasText(renderer, 'View only.')).toBe(true)
    expect(hasButton(renderer, 'Edit')).toBe(false)
    expect(hasButton(renderer, 'More actions')).toBe(false)
  })

  it('is not found for an offer that is not here, and access denied to a supplier', async () => {
    const missing = await show(<OfferScreen id="o-9" />, base({ 'query Offer(': () => ({ offer: null }) }))
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)

    const supplier = await show(<OfferScreen id="o-1" />, base({ 'acting { permissions': () => access([], { id: 'supplier-1' }) }), { acting: actingAs('supplier-admin', 'vendor-orders-fulfil') })
    expect(hasText(supplier.renderer, 'You don’t have access to this offer')).toBe(true)
    expect(asked(supplier.calls, 'query Offer(')).toHaveLength(0)
  })

  it('shows the runs of single-use codes, makes another within the limits, and gets a run’s file to share (Owner)', async () => {
    const batch = { id: 'b-1', prefix: 'INSTA-', length: 8, count: 500, used: 37, createdAt: '2026-10-05T09:00:00.000Z' }
    let exportReads = 0
    const { renderer, calls } = await show(
      <OfferScreen id="o-4" />,
      base({
        'query Offer(': () => ({ offer: singleUse }),
        'query Batches(': () => ({ offerCodeBatches: paged([batch]) }),
        'mutation GenerateCodes(': (variables) => ({ generateCodes: { ...batch, id: 'b-2', count: variables.count } }),
        'mutation ExportOfferCodes(': () => ({ exportOfferCodes: 'x-1' }),
        'query OfferCodesExport(': () => {
          exportReads += 1
          return { offerCodesExport: { id: 'x-1', state: 'done', rows: 500, csv: 'code\nINSTA-AAAA2222\n', expiresAt: null } }
        },
      }),
    )

    expect(hasText(renderer, 'Single-use codes')).toBe(true)
    expect(hasText(renderer, '500 codes · 37 used · 463 unused · start with INSTA-')).toBe(true)
    expect(hasText(renderer, 'Share the code')).toBe(false)

    await type(renderer, 'How many', '5001')
    await click(renderer, 'Make codes')
    expect(hasText(renderer, 'Make between 1 and 5,000 codes at a time.')).toBe(true)
    expect(asked(calls, 'mutation GenerateCodes(')).toHaveLength(0)

    await type(renderer, 'How many', '300')
    await type(renderer, 'Start with', 'spring-')
    await click(renderer, 'Make codes')
    expect(asked(calls, 'mutation GenerateCodes(')[0]?.variables).toEqual({ id: 'o-4', count: 300, prefix: 'SPRING-', length: 8 })
    expect(hasText(renderer, '300 codes made.')).toBe(true)

    await click(renderer, 'Get the codes (CSV)')
    expect(exportReads).toBe(1)
    expect(shareCsv).toHaveBeenCalledWith('insta-codes.csv', 'code\nINSTA-AAAA2222\n')
  })

  it('leaves out a run’s file and the chance to make runs for Staff, who may only read the runs', async () => {
    const batch = { id: 'b-1', prefix: 'INSTA-', length: 8, count: 500, used: 37, createdAt: '2026-10-05T09:00:00.000Z' }
    const { renderer } = await show(
      <OfferScreen id="o-4" />,
      base({ 'acting { permissions': () => access(staff), 'query Offer(': () => ({ offer: singleUse }), 'query Batches(': () => ({ offerCodeBatches: paged([batch]) }) }),
      { acting: actingAs('staff') },
    )

    expect(hasText(renderer, '500 codes · 37 used · 463 unused · start with INSTA-')).toBe(true)
    expect(hasButton(renderer, 'Get the codes (CSV)')).toBe(false)
    expect(hasButton(renderer, 'Make codes')).toBe(false)
  })

  it('gives a Manager the codes file, which is not for Staff, but not the Owner-only things it never had', async () => {
    const batch = { id: 'b-1', prefix: '', length: 8, count: 10, used: 0, createdAt: '2026-10-05T09:00:00.000Z' }
    const { renderer } = await show(
      <OfferScreen id="o-4" />,
      base({ 'acting { permissions': () => access(['offers.read', 'offers.write', 'offers.export']), 'query Offer(': () => ({ offer: singleUse }), 'query Batches(': () => ({ offerCodeBatches: paged([batch]) }) }),
      { acting: actingAs('manager') },
    )

    expect(hasButton(renderer, 'Get the codes (CSV)')).toBe(true)
    expect(hasText(renderer, '10 codes · 0 used · 10 unused · start with no prefix')).toBe(true)
  })
})

describe('the offer editor', () => {
  const editor = (id: string | null, handlers: Handlers = {}, options: Options = {}, kind?: string) => show(<OfferEditorScreen id={id} {...(kind ? { type: kind } : {})} />, base(handlers), options)

  it('starts a new offer from the kind, and shows what that kind needs', async () => {
    const picked = await editor(null)
    expect(hasText(picked.renderer, 'What kind of offer?')).toBe(true)
    expect(hasField(picked.renderer, 'Name shoppers see')).toBe(false)

    await choose(picked.renderer, 'Buy X, get Y')
    expect(texts(picked.renderer)).toEqual(expect.arrayContaining(['What does the shopper get?', 'Customer buys', 'and gets']))
    expect(input(picked.renderer, 'Name shoppers see').props.value).toBe('Buy 2, get 1 free')

    for (const [kind, expected] of [
      ['products', 'Applies to'],
      ['order', 'Kind of discount'],
      ['shipping', 'Free or money off'],
    ] as const) {
      const direct = await editor(null, {}, {}, kind)
      expect(hasText(direct.renderer, expected)).toBe(true)
    }
  })

  it('sends a new offer as the form says, started now, after saying what it will do', async () => {
    const { renderer: shown, calls } = await editor(null, { 'mutation SaveOffer(': () => ({ saveOffer: { id: 'o-new', revision: 1 } }) }, {}, 'order')

    await type(shown, 'Code shoppers type', 'spring10')
    await click(shown, 'Save')
    expect(hasText(shown, 'Start now?')).toBe(true)
    expect(asked(calls, 'mutation SaveOffer(')).toHaveLength(0)

    await click(shown, 'Save', -1)
    const sent = asked(calls, 'mutation SaveOffer(')[0]?.variables
    expect(sent).toMatchObject({
      id: null,
      revision: null,
      input: { name: '10% off your order', code: 'SPRING10', trigger: 'code', enabled: true, action: { operation: 'order_percentage_discount', percent: 10 }, perCustomerLimit: 1 },
    })
    expect(mockReplace).toHaveBeenCalledWith('/offers/o-new')
    expect(hasText(shown, 'Your code SPRING10 is live')).toBe(true)
  })

  it('keeps a new offer off when asked, and sends it disabled', async () => {
    const { renderer: shown, calls } = await editor(null, { 'mutation SaveOffer(': () => ({ saveOffer: { id: 'o-new', revision: 1 } }) }, {}, 'shipping')

    await click(shown, 'Save')
    await click(shown, 'Keep off: turn it on later from Offers')
    await click(shown, 'Save', -1)
    expect(asked(calls, 'mutation SaveOffer(')[0]?.variables).toMatchObject({ input: { enabled: false, trigger: 'automatic', action: { operation: 'free_shipping' } } })
  })

  it('refuses to save an incomplete form, and says what is missing without asking the API', async () => {
    const { renderer: shown, calls } = await editor(null, {}, {}, 'order')

    await click(shown, 'Save')
    expect(hasText(shown, 'Type a code or generate one.')).toBe(true)
    expect(asked(calls, 'mutation SaveOffer(')).toHaveLength(0)
    expect(hasText(shown, 'Start now?')).toBe(false)
  })

  it('says by the code box that a code is taken, and by whom', async () => {
    const { renderer: shown } = await editor(
      null,
      {
        'mutation SaveOffer(': () => {
          throw new ApiError('CODE_TAKEN', 'x', { name: 'Spring sale', status: 'live' })
        },
      },
      {},
      'order',
    )

    await type(shown, 'Code shoppers type', 'spring10')
    await click(shown, 'Save')
    await click(shown, 'Save', -1)
    expect(hasText(shown, 'SPRING10 is already used by “Spring sale” (Live).')).toBe(true)
    expect(hasText(shown, 'Start now?')).toBe(false)
  })

  it('edits an offer at the revision it was read at, asking before a change to a live offer', async () => {
    const { renderer: shown, calls } = await editor('o-1', { 'mutation SaveOffer(': () => ({ saveOffer: { id: 'o-1', revision: 4 } }) })

    expect(input(shown, 'Name shoppers see').props.value).toBe('Welcome 10% off')
    await type(shown, 'Name shoppers see', 'Welcome 15% off')
    await click(shown, 'Save changes')
    expect(hasText(shown, 'Save changes to a live offer?')).toBe(true)
    expect(asked(calls, 'mutation SaveOffer(')).toHaveLength(0)

    await click(shown, 'Save changes', -1)
    expect(asked(calls, 'mutation SaveOffer(')[0]?.variables).toMatchObject({ id: 'o-1', revision: 3, input: { name: 'Welcome 15% off', code: 'WELCOME10', enabled: true } })
    expect(mockBack).toHaveBeenCalled()
  })

  it('offers their version or keeping yours when someone else saved first', async () => {
    const { renderer: shown } = await editor('o-1', {
      'mutation SaveOffer(': () => {
        throw new ApiError('STALE_REVISION', 'x', { revision: 5 })
      },
    })

    await type(shown, 'Name shoppers see', 'Welcome 15% off')
    await click(shown, 'Save changes')
    await click(shown, 'Save changes', -1)
    expect(hasText(shown, 'Someone changed this offer since you opened it.')).toBe(true)
    expect(hasButton(shown, 'Load their version')).toBe(true)
    expect(hasButton(shown, 'Keep mine')).toBe(true)
  })

  it('is told to Staff, who read offers but cannot change them, before anything is read', async () => {
    const { renderer: shown, calls } = await editor('o-1', { 'acting { permissions': () => access(staff) }, { acting: actingAs('staff') })

    expect(hasText(shown, 'You can’t edit offers')).toBe(true)
    expect(asked(calls, 'query Offer(')).toHaveLength(0)
  })

  it('opens an offer’s form without anything to change while the store is read-only', async () => {
    const { renderer: shown } = await editor('o-1', {}, { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(shown, 'Your store is view-only. Offers can’t be changed until billing is sorted.')).toBe(true)
    expect(hasButton(shown, 'Save changes')).toBe(false)
    expect(input(shown, 'Name shoppers see').props.editable).toBe(false)
  })

  it('says the offer is not here for an id that does not exist', async () => {
    const { renderer: shown } = await editor('o-9', { 'query Offer(': () => ({ offer: null }) })

    expect(hasText(shown, 'This page isn’t here any more')).toBe(true)
  })

  it('shows the form’s summary sentence as the offer is built', async () => {
    const { renderer: shown } = await editor(null, {}, {}, 'order')

    await type(shown, 'Code shoppers type', 'spring10')
    expect(hasText(shown, '10% off the whole order · code SPRING10')).toBe(true)
  })
})
