import type { ReactElement } from 'react'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: async () => ({ granted: true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../products/files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({ authorization: 'Bearer token' }) }) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

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
const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
const textIn = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === 'string' ? child : textIn(child))).join('')
// A choice row is its label and what it means; this presses the one whose label is `label`.
const pick = async (renderer: ReactTestRenderer, label: string) => {
  const row = renderer.root.findAll((node) => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function' && textIn(node).startsWith(label))[0]
  if (!row) throw new Error(`no choice named "${label}"`)
  await press(row)
  await settle()
}
// The last button of that name is the one in the sheet that opened over the screen.
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressablesNamed(renderer, label).at(-1) as ReactTestInstance)
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

const info = {
  name: 'Kesari Threads',
  legalName: null,
  description: null,
  logoAssetId: null,
  address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
  contactEmail: 'hello@kesarithreads.in',
  contactPhone: null,
  country: 'IN',
  taxId: null,
  timeZone: 'Asia/Kolkata',
  unitSystem: 'metric',
  orderPrefix: 'KT-',
  nextOrderNumber: '1042',
}

describe('Settings is the Owner’s', () => {
  it.each(['tax'])('opening %s by a deep link as a Manager is access denied, and reads and writes nothing', async (tab) => {
    const { renderer, calls } = await show(<SettingsTabScreen tab={tab} />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('says a tab that does not exist is a 404 for the Owner only', async () => {
    const missing = await show(<SettingsTabScreen tab="payments" />, {})
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)
    const hidden = await show(<SettingsTabScreen tab="payments" />, {}, { acting: actingAs('manager') })
    expect(hasText(hidden.renderer, 'You don’t have access to Settings')).toBe(true)
  })
})

const taxSetup = {
  pricesIncludeTax: true,
  classes: [
    { id: 't12', name: 'Clothing', isDefault: true, taxCode: null, versions: 41 },
    { id: 't5', name: 'Under ₹1,000', isDefault: false, taxCode: '6109', versions: 0 },
  ],
  zones: [
    { id: 'z-in', name: 'India', countries: ['IN'], regions: [], rates: [{ taxClassId: 't12', rateBps: 1200 }, { taxClassId: 't5', rateBps: 500 }] },
    { id: 'z-ae', name: 'UAE', countries: ['AE'], regions: [], rates: [{ taxClassId: 't12', rateBps: 500 }] },
  ],
}

describe('Tax setup', () => {
  const tax = (over: Handlers = {}): Handlers => ({
    '{ taxSetup {': () => ({ taxSetup: taxSetup }),
    '{ invoiceSettings {': () => ({ invoiceSettings: { taxPerLine: true, emailWithDispatch: false, footer: 'Thank you', legalName: 'Kesari Threads Pvt Ltd' } }),
    '{ storeInfo {': () => ({ storeInfo: { ...info, taxId: '08ABCDE1234F1Z5' } }),
    ...over,
  })

  it('shows the rates the API holds, in words naming the tax, with no price worked out', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Clothing', '12%', 'default for new products', '5%', 'Rates in other places', 'UAE', 'Your tax number: 08ABCDE1234F1Z5']))
    expect(hasText(renderer, 'The price you type is the price shoppers pay; GST is part of it.')).toBe(true)
  })

  it('switches how prices are typed only after saying the numbers stay and what shoppers pay changes', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation SetPricesIncludeTax': () => ({ setPricesIncludeTax: true }) }))

    await pick(renderer, 'Prices don’t include GST')
    await click(renderer, 'Save')
    expect(hasText(renderer, 'Prices exclude GST from now on?')).toBe(true)
    expect(hasText(renderer, 'The numbers you typed on your products stay as they are')).toBe(true)
    expect(asked(calls, 'mutation SetPricesIncludeTax')).toHaveLength(0)
    await press(pressablesNamed(renderer, 'Save').at(-1) as never)
    await settle()

    expect(asked(calls, 'mutation SetPricesIncludeTax')[0]?.variables).toEqual({ i: false })
    expect(hasText(renderer, 'Prices now exclude GST — it’s added at checkout')).toBe(true)
  })

  it('adds a category with its rate in basis points, the home zone named for the country', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation AddTaxCategory': () => ({ addTaxCategory: 't7' }) }))

    await click(renderer, 'Add a rate')
    await type(renderer, 'Name', 'Books')
    await type(renderer, 'Rate, %', '7.5')
    await click(renderer, 'Add')

    expect(asked(calls, 'mutation AddTaxCategory')[0]?.variables).toEqual({ n: 'Books', r: 750, h: 'India' })
  })

  it('changes a category’s rate at home, and refuses what is not a percentage', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation SetHomeTaxRate': () => ({ setHomeTaxRate: true }) }))

    await click(renderer, 'Manage Clothing')
    await click(renderer, 'Change its rate')
    await type(renderer, 'Rate, %', '101')
    await clickLast(renderer, 'Save')
    expect(hasText(renderer, 'Type a percentage from 0 to 100')).toBe(true)
    expect(asked(calls, 'mutation SetHomeTaxRate')).toHaveLength(0)
    await type(renderer, 'Rate, %', '18')
    await clickLast(renderer, 'Save')

    expect(asked(calls, 'mutation SetHomeTaxRate')[0]?.variables).toEqual({ c: 't12', r: 1800, h: 'India' })
  })

  it('never offers deleting the default nor a category a product version uses, and deletes an unused one after asking', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation DeleteTaxClass': () => ({ deleteTaxClass: true }) }))

    await click(renderer, 'Manage Clothing')
    expect(pressablesNamed(renderer, 'Delete')).toHaveLength(0)
    await click(renderer, 'Manage Under ₹1,000')
    await click(renderer, 'Delete')
    expect(hasText(renderer, 'No product uses it, so nothing else changes.')).toBe(true)
    await press(pressablesNamed(renderer, 'Delete').at(-1) as never)
    await settle()

    expect(asked(calls, 'mutation DeleteTaxClass')[0]?.variables).toEqual({ id: 't5' })
  })

  it('makes a category the default from what it is now, so a name changed meanwhile is not overwritten', async () => {
    let reads = 0
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="tax" />,
      tax({
        '{ taxSetup {': () => {
          reads += 1
          return { taxSetup: { ...taxSetup, classes: taxSetup.classes.map((taxClass) => (reads > 1 && taxClass.id === 't5' ? { ...taxClass, name: 'Under ₹1,000 (revised)' } : taxClass)) } }
        },
        'mutation MakeDefaultClass': () => ({ saveTaxClass: 't5' }),
      }),
    )

    await click(renderer, 'Manage Under ₹1,000')
    await click(renderer, 'Make default for new products')
    expect(hasText(renderer, 'Products you’ve already priced keep theirs.')).toBe(true)
    expect(asked(calls, 'mutation MakeDefaultClass')).toHaveLength(0)
    await clickLast(renderer, 'Make default for new products')

    expect(asked(calls, 'mutation MakeDefaultClass')[0]?.variables).toEqual({ id: 't5', input: { name: 'Under ₹1,000 (revised)', taxCode: '6109', isDefault: true } })
  })

  it('does not draw a wrong screen when the store’s country could not be read: it says it could not load', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax({ '{ storeInfo {': () => { throw new ApiError('NO_RESPONSE', 'x') } }))

    expect(hasText(renderer, 'We couldn’t load Tax setup')).toBe(true)
    expect(hasText(renderer, 'Rate depends on the shopper’s state')).toBe(false)
  })

  it('saves the invoice switches and sends the footer back as it is', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation SaveInvoiceSettings': () => ({ saveInvoiceSettings: true }) }))

    await click(renderer, 'Email the invoice with the dispatch note')
    await click(renderer, 'Save invoice settings')

    expect(asked(calls, 'mutation SaveInvoiceSettings')[0]?.variables).toEqual({ input: { taxPerLine: true, emailWithDispatch: true, footer: 'Thank you' } })
  })

  it('shows a refusal by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation AddTaxCategory': () => { throw new ApiError('DUPLICATE_NAME', 'x') } }))

    await click(renderer, 'Add a rate')
    await type(renderer, 'Name', 'Clothing')
    await type(renderer, 'Rate, %', '12')
    await click(renderer, 'Add')

    expect(hasText(renderer, 'Another category already has that name.')).toBe(true)
  })

  it('says a store with no country yet has none to set up, rather than drawing the US or VAT screen', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax({ '{ storeInfo {': () => ({ storeInfo: { ...info, country: null } }) }))

    expect(hasText(renderer, 'Your store has no country yet, so its tax can’t be set up here.')).toBe(true)
    expect(hasText(renderer, 'Rate depends on the shopper’s state')).toBe(false)
    expect(hasText(renderer, 'VAT')).toBe(false)
    expect(hasText(renderer, 'Stores here usually')).toBe(false)
    expect(pressablesNamed(renderer, 'Add a rate')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Manage Under ₹1,000')).toHaveLength(1)
  })

  it('leaves a US store’s rates to the shopper’s state: no add and no rate change', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax({ '{ storeInfo {': () => ({ storeInfo: { ...info, country: 'US' } }) }))

    expect(hasText(renderer, 'Rate depends on the shopper’s state')).toBe(true)
    expect(pressablesNamed(renderer, 'Add a rate')).toHaveLength(0)
  })
})

