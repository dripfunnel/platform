import type { ReactTestRenderer } from 'react-test-renderer'
import { locale, t } from '../../messages'
import { fakeShop, hasText, press, pressableNamed, render } from '../../testing/harness'
import { AccountLinks } from '../account/AccountLinks'
import { currencyLabel, languageLabel } from './labels'
import { MarketsContext, type Markets } from './MarketsContext'
import { MarketsScreen } from './MarketsScreen'

jest.setTimeout(120_000)

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }))
jest.mock('@dripfunnel/mobile-shared/brand', () => ({ useBrand: () => ({ brand: null, source: 'defaults' }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const choose = jest.fn()
const markets = (over: Partial<Markets> = {}): Markets => ({ offers: { languages: ['en', 'hi'], currencies: ['INR', 'AED'] }, choice: { language: null, currency: null }, key: 'en|INR', choose, ...over })

const show = (value: Markets, ui = <MarketsScreen />): Promise<ReactTestRenderer> => render(<MarketsContext.Provider value={value}>{ui}</MarketsContext.Provider>, fakeShop(() => ({})))

// The rows are named as the shopper reads them: a language in its own words, a currency by name and code.
const row = (code: string): string => (code.length === 3 ? currencyLabel(code, locale) : languageLabel(code))
const checked = (screen: ReactTestRenderer, code: string): boolean => pressableNamed(screen, row(code)).props.accessibilityState.checked

beforeEach(() => {
  choose.mockClear()
  mockPush.mockClear()
})

describe('Language and currency', () => {
  it('lists the store’s languages and currencies, the main language and the pricing currency chosen until the shopper picks', async () => {
    const screen = await show(markets())
    expect(checked(screen, 'en')).toBe(true)
    expect(checked(screen, 'hi')).toBe(false)
    expect(checked(screen, 'INR')).toBe(true)
    expect(checked(screen, 'AED')).toBe(false)
    expect(hasText(screen, t('markets.currencyNote'))).toBe(true)
  })

  it('shows what the shopper picked', async () => {
    const screen = await show(markets({ choice: { language: 'hi', currency: 'AED' } }))
    expect(checked(screen, 'hi')).toBe(true)
    expect(checked(screen, 'AED')).toBe(true)
    expect(checked(screen, 'en')).toBe(false)
  })

  it('keeps a language, and a currency, as separate picks', async () => {
    const screen = await show(markets())
    await press(screen, row('hi'))
    expect(choose).toHaveBeenLastCalledWith({ language: 'hi' })
    await press(screen, row('AED'))
    expect(choose).toHaveBeenLastCalledWith({ currency: 'AED' })
  })

  it('says a store with one currency sells in it only', async () => {
    const screen = await show(markets({ offers: { languages: ['en'], currencies: ['USD'] } }))
    expect(hasText(screen, t('markets.oneCurrency', { shop: t('markets.thisShop'), currency: 'USD' }))).toBe(true)
  })

  it('says the lists are not loaded when nothing is known of what the store offers', async () => {
    const screen = await show(markets({ offers: null }))
    expect(hasText(screen, t('markets.unavailable.title'))).toBe(true)
  })
})

describe('Account’s links', () => {
  it('open Language and currency, saying what is chosen, and the legal pages', async () => {
    const screen = await show(markets({ choice: { language: 'hi', currency: 'AED' } }), <AccountLinks />)
    const chosen = `${languageLabel('hi')} · AED`
    expect(hasText(screen, chosen)).toBe(true)
    await press(screen, `${t('markets.title')}, ${chosen}`)
    expect(mockPush).toHaveBeenLastCalledWith('/account/markets')
    await press(screen, `${t('legal.title')}, ${t('legal.rowBody')}`)
    expect(mockPush).toHaveBeenLastCalledWith('/account/legal')
  })
})
