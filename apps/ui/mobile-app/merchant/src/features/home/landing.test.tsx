import type { ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { buildTheme, ThemeProvider } from '@dripfunnel/mobile-shared/theme'
import Catalogue from '../../app/(tabs)/catalogue/index'
import Orders from '../../app/(tabs)/orders/index'
import { pressableNamed } from '../../testing/harness'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockParams: { current: Record<string, string> } = { current: {} }
const mockMounts: string[] = []

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams.current }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

// Each stub notes the chip it was opened on every time it mounts; a mount is a fresh start of the list.
jest.mock('../orders/OrdersScreen', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    OrdersScreen: ({ initialFilter }: { initialFilter: string }) => {
      useEffect(() => void mockMounts.push(`orders:${initialFilter}`), [])
      return null
    },
  }
})
jest.mock('../products/ProductsScreen', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    ProductsScreen: ({ initialFilter }: { initialFilter: string }) => {
      useEffect(() => void mockMounts.push(`products:${initialFilter}`), [])
      return null
    },
  }
})
jest.mock('../collections/CollectionsArea', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    CollectionsArea: () => {
      useEffect(() => void mockMounts.push('collections'), [])
      return null
    },
  }
})

const draw = async (element: () => ReactElement) => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(<ThemeProvider theme={buildTheme('light')}>{element()}</ThemeProvider>)
  })
  return renderer
}

const arrive = async (renderer: ReactTestRenderer, element: () => ReactElement, params: Record<string, string>) => {
  mockParams.current = params
  await act(async () => renderer.update(<ThemeProvider theme={buildTheme('light')}>{element()}</ThemeProvider>))
}

beforeEach(() => {
  mockMounts.length = 0
  mockParams.current = {}
})

describe('a list opened from Home’s Needs you', () => {
  it('opens Orders on the chip the link names, and on All with none', async () => {
    mockParams.current = { filter: 'TO_SHIP', visit: '1' }
    const renderer = await draw(() => <Orders />)
    expect(mockMounts).toEqual(['orders:TO_SHIP'])

    await arrive(renderer, () => <Orders />, {})
    expect(mockMounts).toEqual(['orders:TO_SHIP', 'orders:ALL'])
  })

  it('starts Orders on the chip again on the next press, though the chip is the same', async () => {
    mockParams.current = { filter: 'TO_SHIP', visit: '1' }
    const renderer = await draw(() => <Orders />)

    await arrive(renderer, () => <Orders />, { filter: 'TO_SHIP', visit: '1' })
    expect(mockMounts).toEqual(['orders:TO_SHIP'])

    await arrive(renderer, () => <Orders />, { filter: 'TO_SHIP', visit: '2' })
    expect(mockMounts).toEqual(['orders:TO_SHIP', 'orders:TO_SHIP'])
  })

  it('opens Catalogue’s Products on the chip the link names, and ignores a chip it does not know', async () => {
    mockParams.current = { filter: 'low_stock', visit: '1' }
    const renderer = await draw(() => <Catalogue />)
    expect(mockMounts).toEqual(['products:low_stock'])

    await arrive(renderer, () => <Catalogue />, { filter: 'nonsense', visit: '2' })
    expect(mockMounts).toEqual(['products:low_stock', 'products:all'])
  })

  it('starts Products on the chip again on the next press, though the chip is the same and Products never left the screen', async () => {
    mockParams.current = { filter: 'low_stock', visit: '1' }
    const renderer = await draw(() => <Catalogue />)

    await arrive(renderer, () => <Catalogue />, { filter: 'low_stock', visit: '1' })
    expect(mockMounts).toEqual(['products:low_stock'])

    await arrive(renderer, () => <Catalogue />, { filter: 'low_stock', visit: '2' })
    expect(mockMounts).toEqual(['products:low_stock', 'products:low_stock'])
  })

  it('starts Products on the chip again on the next press, even after the person changed to another segment', async () => {
    mockParams.current = { filter: 'low_stock', visit: '1' }
    const renderer = await draw(() => <Catalogue />)

    await act(async () => (pressableNamed(renderer, 'Collections').props.onPress as () => void)())
    expect(mockMounts).toEqual(['products:low_stock', 'collections'])

    await arrive(renderer, () => <Catalogue />, { filter: 'low_stock', visit: '2' })
    expect(mockMounts).toEqual(['products:low_stock', 'collections', 'products:low_stock'])
  })
})
