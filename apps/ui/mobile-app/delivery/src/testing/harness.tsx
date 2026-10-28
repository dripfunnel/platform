import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { buildTheme, ThemeProvider } from '@dripfunnel/mobile-shared/theme'
import { SessionContext, type Session } from '../session/SessionContext'

// What the screens' tests share: a fake Delivery API that answers by the operation's text, and a renderer that reads what is on screen.
export type Request = { query: string; variables: Record<string, unknown> | undefined }
export type Answer = (request: Request) => unknown

export type FakeSession = Session & { requests: Request[]; events: string[]; uploads: { uri: string; mimeType: string }[] }

export const fakeSession = (answer: Answer, { signedIn = true, photoId = 'asset-1' }: { signedIn?: boolean; photoId?: string } = {}): FakeSession => {
  const requests: Request[] = []
  const events: string[] = []
  const uploads: { uri: string; mimeType: string }[] = []
  return {
    host: 'acme.my-store.one',
    requests,
    events,
    uploads,
    signedIn,
    startSession: (token) => {
      events.push(`start:${token}`)
      return Promise.resolve()
    },
    signOut: () => {
      events.push('signOut')
      return Promise.resolve()
    },
    leave: () => {
      events.push('leave')
      return Promise.resolve()
    },
    fetchRider: async () => {
      const { me } = (await answer({ query: '{ me }', variables: undefined })) as { me: Awaited<ReturnType<Session['fetchRider']>> }
      return me
    },
    uploadPhoto: (uri, mimeType) => {
      uploads.push({ uri, mimeType })
      return Promise.resolve(photoId)
    },
    client: {
      request: async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => {
        const request = { query, variables }
        requests.push(request)
        return (await answer(request)) as T
      },
    },
  }
}

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((renderer) => renderer.unmount()))
})

export const render = async (children: ReactNode, session: Session): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      <ThemeProvider theme={buildTheme('light')}>
        <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
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

// A Pressable is several nested components that all carry its props: any of them presses it.
const pressables = (renderer: ReactTestRenderer): ReactTestInstance[] => renderer.root.findAll((node) => typeof node.props.onPress === 'function')

export const pressableNamed = (renderer: ReactTestRenderer, name: string): ReactTestInstance => {
  const all = pressables(renderer)
  const found = all.find((node) => node.props.accessibilityLabel === name) ?? all.find((node) => textOf(node) === name)
  if (!found) throw new Error(`No button named "${name}". On screen: ${texts(renderer).join(' | ')}`)
  return found
}

export const hasButton = (renderer: ReactTestRenderer, name: string): boolean => pressables(renderer).some((node) => node.props.accessibilityLabel === name || textOf(node) === name)

export const press = async (renderer: ReactTestRenderer, name: string): Promise<void> => {
  const target = pressableNamed(renderer, name)
  await act(async () => target.props.onPress())
  await flush()
}

/** Types into the field with this label. */
export const fill = async (renderer: ReactTestRenderer, label: string, value: string): Promise<void> => {
  const input = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!input) throw new Error(`No field "${label}". On screen: ${texts(renderer).join(' | ')}`)
  await act(async () => input.props.onChangeText(value))
}

export const isDisabled = (node: ReactTestInstance): boolean => Boolean(node.props.disabled || node.props.accessibilityState?.disabled)
