import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import type { ApiClient } from '../graphql'
import { FeedbackProvider } from '../features/shell/Feedback'
import { ShellDataProvider } from '../features/shell/ShellData'
import type { Acting } from '../session/sessionStore'
import { buildTheme, ThemeProvider } from '../theme'

// The shell's tests render real components against a fake API that answers the four shell reads.
export type FakeApi = { me?: { name: string | null; email: string }; badges?: { products: number | null; toShip: number | null } | null; state?: unknown; theme?: string | null }

export const fakeClient = ({ me = { name: 'Farhan Ali', email: 'farhan@example.com' }, badges = { products: 2, toShip: 5 }, state = null, theme = 'light' }: FakeApi = {}): ApiClient => ({
  request: <T,>(query: string): Promise<T> => {
    const answer = query.includes('navBadges') ? { navBadges: badges } : query.includes('storeState') ? { storeState: state } : query.includes('profile') ? { profile: { theme } } : { me }
    return Promise.resolve(answer as T)
  },
})

export const actingAs = (role: string, tier: string | null = null, change: Partial<Acting> = {}): Acting => ({ storeId: 'store-1', supplierId: tier ? 'supplier-1' : null, storeName: 'Juniper & Co.', role, tier, ...change })

export const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

// Rendered trees are unmounted after each test, so a later change to a shared store doesn't update a dead screen.
const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((renderer) => renderer.unmount()))
})

type Options = { acting?: Acting | null; client?: ApiClient }

/** Renders `children` inside the theme, the toasts and sheets, and the shell's data for the acting store. */
export const renderShell = async (children: ReactNode, { acting = actingAs('owner'), client = fakeClient() }: Options = {}): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      <ThemeProvider theme={buildTheme('light')}>
        <FeedbackProvider>
          <ShellDataProvider acting={acting} client={client}>
            {children}
          </ShellDataProvider>
        </FeedbackProvider>
      </ThemeProvider>,
    )
  })
  mounted.push(renderer)
  await flush()
  return renderer
}

const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join(''))

/** Every piece of text on screen, in order. */
export const texts = (renderer: ReactTestRenderer): string[] =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => textOf(node))
    .filter((text) => text !== '')

export const hasText = (renderer: ReactTestRenderer, text: string): boolean => texts(renderer).some((found) => found.includes(text))

// A Pressable is several nested components that all carry its props; the outermost one is the pressable.
const pressables = (renderer: ReactTestRenderer): ReactTestInstance[] =>
  renderer.root.findAll((node) => typeof node.props.onPress === 'function' && node.parent?.props.onPress !== node.props.onPress)

/** The pressables with this role. */
export const byRole = (renderer: ReactTestRenderer, role: string): ReactTestInstance[] => pressables(renderer).filter((node) => node.props.accessibilityRole === role)

/** Every pressable whose label, or text, is `label`, in order. */
export const pressablesNamed = (renderer: ReactTestRenderer, label: string): ReactTestInstance[] =>
  pressables(renderer).filter((node) => node.props.accessibilityLabel === label || textOf(node) === label)

export const pressableNamed = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const found = pressablesNamed(renderer, label)[0]
  if (!found) throw new Error(`nothing to press named "${label}"`)
  return found
}

export const press = async (node: ReactTestInstance): Promise<void> => {
  await act(async () => {
    ;(node.props.onPress as () => void)()
  })
}
