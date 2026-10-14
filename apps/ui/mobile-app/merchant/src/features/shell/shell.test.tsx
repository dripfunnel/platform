import type { ComponentProps } from 'react'
import { Linking, Pressable, Text } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { actingAs, byRole, fakeClient, flush, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import type { ApiClient } from '../../graphql'
import { buildTheme, getMode, ThemeProvider } from '../../theme'
import { resetScenario, setScenario } from '../states/scenario'
import { Button } from '../common/Button'
import { useFeedback } from './Feedback'
import { MoreScreen, helpTarget } from './MoreScreen'
import { ShellDataProvider, useShell } from './ShellData'
import { ShellHeader } from './ShellHeader'
import { TabBar } from './TabBar'

const mockPush = jest.fn()
const mockBack = jest.fn()
const mockLeaveStore = jest.fn()
const mockNavigate = jest.fn()
const mockSignOut = jest.fn(() => Promise.resolve())
const mockOpenUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
let mockBrand: { helpUrl: string | null; supportUrl: string | null; supportEmail: string | null } | null = null
const mockNetListeners: ((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void)[] = []

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack, navigate: jest.fn() }), Tabs: () => null }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('../../session', () => ({ session: () => ({ leaveStore: mockLeaveStore, end: jest.fn() }) }))
jest.mock('../auth/deps', () => ({ flowDeps: () => ({}) }))
jest.mock('../auth/signInFlow', () => ({ signOut: () => mockSignOut() }))
jest.mock('../../brand/BrandProvider', () => ({ useBrand: () => ({ brand: mockBrand, source: 'api', domain: 'store.example.com' }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: (listener: (typeof mockNetListeners)[number]) => (mockNetListeners.push(listener), () => undefined) } }))

const routes = (names: string[]) => names.map((name) => ({ key: `${name}-1`, name }))
const tabBarProps = (names: string[], index = 0) => ({ state: { index, routes: routes(names) }, navigation: { navigate: mockNavigate }, descriptors: {}, insets: { top: 0, bottom: 0, left: 0, right: 0 } }) as unknown as ComponentProps<typeof TabBar>

const tabsFor = async (role: string, tier: string | null = null, names = ['home', 'orders/index', 'catalogue/index', 'offers/index', 'products', 'to-ship', 'more']) => {
  return renderShell(<TabBar {...tabBarProps(names)} />, { acting: actingAs(role, tier) })
}

const tabLabels = (renderer: ReactTestRenderer) => byRole(renderer, 'tab').map((tab) => tab.props.accessibilityLabel as string)

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
  mockBrand = null
})

describe('the tab bar per role and supplier tier', () => {
  it('draws Home, Orders, Catalogue, Offers and More for an Owner, with the badges the API reports', async () => {
    const renderer = await tabsFor('owner')
    expect(tabLabels(renderer)).toEqual(['Home', 'Orders, 5 waiting', 'Catalogue, 2 waiting', 'Offers', 'More'])
  })

  it('gives Staff no badge on Catalogue, since approving is not theirs', async () => {
    const renderer = await tabsFor('staff')
    expect(tabLabels(renderer)).toEqual(['Home', 'Orders, 5 waiting', 'Catalogue', 'Offers', 'More'])
  })

  it('draws Products and More for the stock-only and the catalogue suppliers', async () => {
    for (const tier of ['vendor-stock', 'vendor-catalogue']) {
      const renderer = await tabsFor('supplier-member', tier)
      expect(tabLabels(renderer)).toEqual(['Products', 'More'])
    }
  })

  it('draws Products, To ship and More for the two orders tiers, with the to-ship count', async () => {
    for (const [role, tier] of [['supplier-member', 'vendor-orders-read'], ['supplier-admin', 'vendor-orders-fulfil']] as const) {
      const renderer = await tabsFor(role, tier)
      expect(tabLabels(renderer)).toEqual(['Products', 'To ship, 5 waiting', 'More'])
    }
  })

  it('draws no badge when the count could not be read', async () => {
    const renderer = await renderShell(<TabBar {...tabBarProps(['home', 'orders/index', 'catalogue/index', 'offers/index', 'more'])} />, { client: { request: () => Promise.reject(new Error('down')) } })
    expect(tabLabels(renderer)).toEqual(['Home', 'Orders', 'Catalogue', 'Offers', 'More'])
  })

  it('marks the tab of the current route, and keeps More active on a screen under it', async () => {
    const renderer = await renderShell(<TabBar {...tabBarProps(['home', 'orders/index', 'catalogue/index', 'offers/index', 'more'], 4)} />)
    expect(byRole(renderer, 'tab').map((tab) => tab.props.accessibilityState.selected)).toEqual([false, false, false, false, true])
  })

  it('goes to a tab when it is pressed', async () => {
    const renderer = await tabsFor('owner')
    await press(pressableNamed(renderer, 'Home'))
    await press(pressableNamed(renderer, 'Offers'))
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith('offers/index')
  })

  it('follows the Scenario menu’s role', async () => {
    const renderer = await tabsFor('owner')
    await act(async () => setScenario({ role: 'supplierStock' }))
    expect(tabLabels(renderer)).toEqual(['Products', 'More'])
  })
})

describe('the More screen', () => {
  const more = async (role: string, tier: string | null = null) => renderShell(<MoreScreen />, { acting: actingAs(role, tier) })
  const rows = (renderer: ReactTestRenderer) => byRole(renderer, 'button').map((row) => (row.props.accessibilityLabel as string | undefined) ?? '')

  it('shows the person, the role at the store, and the Owner’s shop items and Settings', async () => {
    const renderer = await more('owner')
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Farhan Ali', 'farhan@example.com', 'Owner at Juniper & Co.', 'Your shop', 'Account']))
    expect(rows(renderer)).toEqual(['Customers', 'Abandoned carts', 'Reports', 'Storefront', 'My profile', 'Settings', 'Switch store', 'Sign out'])
  })

  it('shows Settings to the Owner alone, and never Billing', async () => {
    for (const [role, tier] of [['manager', null], ['staff', null], ['supplier-admin', 'vendor-orders-fulfil'], ['supplier-member', 'vendor-stock']] as const) {
      const renderer = await more(role, tier)
      expect(rows(renderer)).not.toContain('Settings')
    }
    for (const role of ['owner', 'manager', 'staff']) expect(hasText(await more(role), 'Billing')).toBe(false)
  })

  it('marks what a Manager or Staff may only look at', async () => {
    expect(rows(await more('manager'))).toContain('Storefront, view only')
    expect(rows(await more('staff'))).toEqual(['Customers', 'Abandoned carts, view only', 'My profile', 'Switch store', 'Sign out'])
  })

  it('gives a supplier its own sales or team, never the merchant’s items', async () => {
    expect(rows(await more('supplier-member', 'vendor-orders-read'))).toEqual(['Your sales', 'My profile', 'Switch store', 'Sign out'])
    expect(rows(await more('supplier-admin', 'vendor-orders-fulfil'))).toEqual(['Your sales', 'Your team', 'My profile', 'Switch store', 'Sign out'])
    expect(rows(await more('supplier-admin', 'vendor-stock'))).toEqual(['Your team', 'My profile', 'Switch store', 'Sign out'])
    expect(rows(await more('supplier-member', 'vendor-catalogue'))).toEqual(['My profile', 'Switch store', 'Sign out'])
  })

  it('opens a screen under More, My profile, and the chooser', async () => {
    const renderer = await more('owner')
    await press(pressableNamed(renderer, 'Customers'))
    expect(mockPush).toHaveBeenCalledWith('/more/customers')
    await press(pressableNamed(renderer, 'My profile'))
    expect(mockPush).toHaveBeenCalledWith('/profile')
    await press(pressableNamed(renderer, 'Switch store'))
    expect(mockLeaveStore).toHaveBeenCalledTimes(1)
  })

  it('asks in a sheet before signing out, and signs out only on confirm', async () => {
    const renderer = await more('owner')
    await press(pressableNamed(renderer, 'Sign out'))
    expect(hasText(renderer, 'Signs you out of every store on this device.')).toBe(true)
    expect(mockSignOut).not.toHaveBeenCalled()
    const confirm = pressablesNamed(renderer, 'Sign out').at(-1)
    if (!confirm) throw new Error('no confirm button in the sheet')
    await press(confirm)
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('draws the help button only when the partner gave a help, support or email address', async () => {
    expect(rows(await more('owner'))).not.toContain('Help')
    mockBrand = { helpUrl: null, supportUrl: null, supportEmail: 'help@partner.example' }
    const renderer = await more('owner')
    await press(pressableNamed(renderer, 'Help'))
    expect(mockOpenUrl).toHaveBeenCalledWith('mailto:help@partner.example')
  })

  it('prefers the help page, then the support page, then the email address', () => {
    expect(helpTarget({ helpUrl: 'https://h', supportUrl: 'https://s', supportEmail: 'a@b.c' })).toBe('https://h')
    expect(helpTarget({ helpUrl: null, supportUrl: 'https://s', supportEmail: 'a@b.c' })).toBe('https://s')
    expect(helpTarget({ helpUrl: null, supportUrl: null, supportEmail: null })).toBeNull()
    expect(helpTarget(null)).toBeNull()
  })

  it('opens only an https page or a plain address, never another scheme', () => {
    expect(helpTarget({ helpUrl: 'intent://scan#Intent;end', supportUrl: 'tel:+911234567890', supportEmail: null })).toBeNull()
    expect(helpTarget({ helpUrl: 'http://h.example', supportUrl: 'javascript:alert(1)', supportEmail: 'a@b.c' })).toBe('mailto:a@b.c')
    expect(helpTarget({ helpUrl: 'file:///etc/passwd', supportUrl: 'https://s.example/help', supportEmail: null })).toBe('https://s.example/help')
    expect(helpTarget({ helpUrl: null, supportUrl: null, supportEmail: 'a@b.example?cc=x@y.example' })).toBeNull()
    expect(helpTarget({ helpUrl: null, supportUrl: null, supportEmail: 'not an address' })).toBeNull()
  })
})

describe('the header', () => {
  it('shows the store at a tab’s root, and switches store when it is tapped', async () => {
    const renderer = await renderShell(<ShellHeader deep={false} />)
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Juniper & Co.', 'FA']))
    await press(pressableNamed(renderer, 'Juniper & Co., switch store'))
    expect(mockLeaveStore).toHaveBeenCalledTimes(1)
  })

  it('shows Back instead of the store on a deeper screen', async () => {
    const renderer = await renderShell(<ShellHeader deep />)
    expect(hasText(renderer, 'Juniper & Co.')).toBe(false)
    await press(pressableNamed(renderer, 'Back'))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('opens the account sheet from the avatar: My profile, Switch store, Sign out', async () => {
    const renderer = await renderShell(<ShellHeader deep={false} />)
    await press(pressableNamed(renderer, 'Account'))
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Farhan Ali', 'farhan@example.com', 'My profile', 'Switch store', 'Sign out']))
    await press(pressableNamed(renderer, 'My profile'))
    expect(mockPush).toHaveBeenCalledWith('/profile')
  })
})

describe('toasts', () => {
  function Saver({ onUndo }: { onUndo: () => void }) {
    const feedback = useFeedback()
    return (
      <Pressable accessibilityLabel="go" onPress={() => feedback.toast({ message: 'Product deleted', undo: onUndo })}>
        <Text>go</Text>
      </Pressable>
    )
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('shows a message with Undo, runs it once, and goes', async () => {
    const undo = jest.fn()
    const renderer = await renderShell(<Saver onUndo={undo} />)
    await press(pressableNamed(renderer, 'go'))
    expect(hasText(renderer, 'Product deleted')).toBe(true)
    await press(pressableNamed(renderer, 'Undo'))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, 'Product deleted')).toBe(false)
  })

  it('goes by itself after six seconds when it offers Undo', async () => {
    const renderer = await renderShell(<Saver onUndo={jest.fn()} />)
    await press(pressableNamed(renderer, 'go'))
    await act(async () => void jest.advanceTimersByTime(5_900))
    expect(hasText(renderer, 'Product deleted')).toBe(true)
    await act(async () => void jest.advanceTimersByTime(200))
    expect(hasText(renderer, 'Product deleted')).toBe(false)
  })
})

describe('a store switch', () => {
  it('never hands one store’s counts to the next, not even for the first render after the switch', async () => {
    const seen: (number | null)[] = []
    const Probe = () => (seen.push(useShell().badges?.ordersToShip ?? null), null)
    const neverAnswers: ApiClient = { request: () => new Promise(() => undefined) }
    const tree = (storeId: string, client: ApiClient) => (
      <ThemeProvider theme={buildTheme('light')}>
        <ShellDataProvider acting={actingAs('owner', null, { storeId })} client={client}>
          <Probe />
        </ShellDataProvider>
      </ThemeProvider>
    )
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(tree('store-1', fakeClient({ badges: { products: 2, toShip: 5 } })))
    })
    await flush()
    expect(seen.at(-1)).toBe(5)
    seen.length = 0
    await act(async () => renderer.update(tree('store-2', neverAnswers)))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((count) => count === null)).toBe(true)
    await act(async () => renderer.unmount())
  })
})

describe('light or dark, and the connection', () => {
  it('does not carry one person’s look to the next person after a sign-out, even when the next one’s look can’t be read', async () => {
    const failing: ApiClient = { request: () => Promise.reject(new Error('offline')) }
    const tree = (acting: ReturnType<typeof actingAs> | null, client: ApiClient) => (
      <ThemeProvider theme={buildTheme('light')}>
        <ShellDataProvider acting={acting} client={client}>
          {null}
        </ShellDataProvider>
      </ThemeProvider>
    )
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(tree(actingAs('owner'), fakeClient({ theme: 'dark' })))
    })
    await flush()
    expect(getMode()).toBe('dark')
    await act(async () => renderer.update(tree(null, failing)))
    await act(async () => renderer.update(tree(actingAs('owner', null, { storeId: 'store-2' }), failing)))
    await flush()
    expect(getMode()).toBe('light')
    await act(async () => renderer.unmount())
  })

  it('draws the account’s saved dark choice, and goes back to light when no store is acting', async () => {
    const dark = fakeClient({ theme: 'dark' })
    const renderer = await renderShell(<ShellHeader deep={false} />, { client: dark })
    expect(getMode()).toBe('dark')
    await act(async () => renderer.unmount())
    await renderShell(null, { acting: null, client: dark })
    expect(getMode()).toBe('light')
  })

  it('lets the Scenario menu choose the look, and draws light for any other saved value', async () => {
    await renderShell(<ShellHeader deep={false} />, { client: fakeClient({ theme: 'sepia' }) })
    expect(getMode()).toBe('light')
    await act(async () => setScenario({ mode: 'dark' }))
    expect(getMode()).toBe('dark')
  })

  it('stops an account save while offline, and keeps it in a view-only store (My profile takes no store state)', async () => {
    const off = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.props.accessibilityRole === 'button')[0]?.props.accessibilityState.disabled as boolean
    const renderer = await renderShell(<Button label="Save" onPress={jest.fn()} saves />)
    expect(off(renderer)).toBe(false)
    await act(async () => mockNetListeners.forEach((listener) => listener({ isConnected: false, isInternetReachable: false })))
    expect(off(renderer)).toBe(true)
    await act(async () => mockNetListeners.forEach((listener) => listener({ isConnected: true, isInternetReachable: null })))
    expect(off(renderer)).toBe(false)
    const viewOnly = { readOnly: true, status: 'past_due', trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }
    expect(off(await renderShell(<Button label="Save" onPress={jest.fn()} saves />, { client: fakeClient({ state: viewOnly }) }))).toBe(false)
  })
})
