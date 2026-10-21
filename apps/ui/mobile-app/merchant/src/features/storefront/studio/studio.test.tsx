import { Linking } from 'react-native'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../../graphql'
import { fakeApi, type Call } from '../../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../../testing/harness'
import { resetScenario } from '../../states/scenario'
import { StudioScreen } from './StudioScreen'

jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }
const mockParams: { page?: string } = {}
const mockMounts = { count: 0 }

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ dispatch: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../../graphql/partnerDomain', () => ({ partnerDomain: () => 'shop.test' }))
jest.mock('../../../session', () => ({
  sessionClient: () => mockSession.client,
  designClient: () => mockSession.client,
  session: () => ({ leaveStore: jest.fn(), end: jest.fn() }),
}))
jest.mock('../../../brand/BrandProvider', () => ({ useBrand: () => ({ brand: { productName: 'Juniper' } }) }))
jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement, useEffect } = require('react')
  return {
    WebView: (props: Record<string, unknown>) => {
      useEffect(() => {
        mockMounts.count += 1
      }, [])
      return createElement('WebView', props)
    },
  }
})

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }
const owner = ['storefront.read', 'publish']
const manager = ['storefront.read']
const access = (permissions: string[]) => ({ me: { acting: { permissions, seller: null } } })

// The session id is a bearer credential: it appears in the frame's address and in no text, label or log.
const sessionId = 'SESSIONID0123456789abc'
const frameUrl = `https://juniper.webpreview.store/__studio/${sessionId}/`
const studioSession = (over: Record<string, unknown> = {}) => {
  const session = typeof over['session'] === 'string' ? over['session'] : sessionId
  return { studioSession: { state: 'ready', place: null, session, frameUrl: `https://juniper.webpreview.store/__studio/${session}/`, access: 'change', expiresAt: '2026-10-21T10:05:00Z', ...over } }
}
const overviewOf = (over: Record<string, unknown> = {}) => ({ storefront: { status: 'unpublished_changes', template: 'linen', live: { number: 3 }, draft: { previewReady: true }, history: [{ number: 3 }, { number: 2 }], ...over } })
const line = (id: string, role: string, text: string, over: Record<string, unknown> = {}) => ({ id, role, text, changed: [], sampleUrl: null, canUndo: false, undone: false, ...over })
const chatOf = (messages: unknown[] = [line('m2', 'ai', 'I warmed the background.', { changed: ['Colours'], canUndo: true }), line('m1', 'user', 'Make it warmer')]) => ({ designChat: { messages } })

const base = (over: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(owner),
  'storefront { status': () => overviewOf(),
  storefrontDomains: () => ({ storefrontDomains: { domains: [{ host: 'juniper.my-store.one', primary: true }] } }),
  storefrontTemplates: () => ({ storefrontTemplates: [{ key: 'linen', name: 'Linen', tag: 'Warm', description: 'Soft', demoUrl: null, current: true }] }),
  customPagePaths: () => ({ products: { nodes: [{ name: 'Indigo kurta', slug: 'indigo-kurta' }] }, customPagePaths: ['/lookbook'] }),
  'contentPages(first': () => ({ contentPages: { nodes: [{ title: 'Questions', path: '/faq' }], pageInfo: { hasNextPage: false, endCursor: null } } }),
  'query Studio(': () => studioSession(),
  'mutation Renew(': () => ({ renewStudioSession: 'ok' }),
  designChat: () => chatOf(),
  ...over,
})

const show = async (handlers: Handlers, role = 'owner') => {
  const { client, calls } = fakeApi(handlers)
  mockSession.client = client
  const renderer = await renderShell(<StudioScreen />, { acting: actingAs(role) })
  await settle()
  return { renderer, calls }
}

const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  const found = pressablesNamed(renderer, label).at(-1)
  if (!found) throw new Error(`nothing to press named "${label}"`)
  await press(found)
  await settle()
}
const hasButton = (renderer: ReactTestRenderer, label: string) => pressablesNamed(renderer, label).length > 0
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const field = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  return found
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => act(async () => field(renderer, label).props.onChangeText(value))
const frames = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'WebView')
const frameProps = (renderer: ReactTestRenderer) => {
  const found = frames(renderer)[0]
  if (!found) throw new Error('no frame')
  return found.props as { source: { uri: string }; onMessage?: unknown; injectedJavaScript?: unknown; injectedJavaScriptBeforeContentLoaded?: unknown; incognito?: boolean; originWhitelist: string[]; onShouldStartLoadWithRequest: (request: { url: string }) => boolean; onNavigationStateChange: (state: { url: string }) => void; sharedCookiesEnabled?: boolean }
}
const everyLabel = (renderer: ReactTestRenderer) => JSON.stringify([texts(renderer), renderer.root.findAll((node) => typeof node.props.accessibilityLabel === 'string').map((node) => node.props.accessibilityLabel as string)])

const openURL = jest.spyOn(Linking, 'openURL')

beforeEach(() => {
  jest.clearAllMocks()
  mockMounts.count = 0
  openURL.mockResolvedValue(true)
  delete mockParams.page
  resetScenario()
})

describe('the studio’s frame (AI-STUDIO §1, §8)', () => {
  it('loads only from the store’s preview origin, under its studio session, carrying none of the app’s', async () => {
    const { renderer } = await show(base())

    const frame = frameProps(renderer)
    expect(frames(renderer)).toHaveLength(1)
    expect(frame.source).toEqual({ uri: frameUrl })
    expect(frame.originWhitelist).toEqual(['https://juniper.webpreview.store/*'])
    expect(frame.incognito).toBe(true)
    expect(frame.sharedCookiesEnabled).toBe(false)
    expect(JSON.stringify(frame.source)).not.toMatch(/token|bearer|authorization/i)
  })

  it('gets no script and no bridge: it has no onMessage, so any message from it, from any origin, is ignored', async () => {
    const { renderer } = await show(base())

    const frame = frameProps(renderer)
    expect(frame.onMessage).toBeUndefined()
    expect(frame.injectedJavaScript).toBeUndefined()
    expect(frame.injectedJavaScriptBeforeContentLoaded).toBeUndefined()
  })

  it('refuses, where the web view asks, any address outside its own session, so a link out of the frame goes nowhere', async () => {
    const { renderer } = await show(base())

    const { onShouldStartLoadWithRequest: allows } = frameProps(renderer)
    expect(allows({ url: frameUrl })).toBe(true)
    expect(allows({ url: `${frameUrl}collections/all/` })).toBe(true)
    expect(allows({ url: 'https://evil.example/' })).toBe(false)
    expect(allows({ url: 'https://juniper.webpreview.store/' })).toBe(false)
    expect(allows({ url: 'https://shop.test/' })).toBe(false)
    expect(allows({ url: 'https://juniper.webpreview.store/__studio/another/' })).toBe(false)
    expect(allows({ url: `${frameUrl}%2e%2e/%2e%2e/other/` })).toBe(false)
    expect(allows({ url: `${frameUrl}../other/` })).toBe(false)
  })

  it('puts the frame back at its own page when it ends up outside its session where the web view did not ask first (an Android redirect or sub-frame)', async () => {
    const { renderer } = await show(base())
    const started = mockMounts.count

    await act(async () => frameProps(renderer).onNavigationStateChange({ url: 'https://evil.example/' }))
    expect(mockMounts.count).toBe(started + 1)
    expect(frameProps(renderer).source.uri).toBe(frameUrl)

    await act(async () => frameProps(renderer).onNavigationStateChange({ url: `${frameUrl}%2e%2e/other/` }))
    expect(mockMounts.count).toBe(started + 2)

    await act(async () => frameProps(renderer).onNavigationStateChange({ url: `${frameUrl}cart/` }))
    await act(async () => frameProps(renderer).onNavigationStateChange({ url: 'about:blank' }))
    expect(mockMounts.count).toBe(started + 2)
  })

  it.each([
    ['the portal’s own host', 'https://shop.test/__studio/SESSIONID0123456789abc/'],
    ['plain http', 'http://juniper.webpreview.store/__studio/SESSIONID0123456789abc/'],
    ['an address outside /__studio/', 'https://juniper.webpreview.store/'],
  ])('shows no frame at all for %s', async (_name, address) => {
    const { renderer } = await show(base({ 'query Studio(': () => studioSession({ frameUrl: address }) }))

    expect(frames(renderer)).toHaveLength(0)
    expect(hasText(renderer, 'The studio couldn’t start. Try again in a minute.')).toBe(true)
  })

  it('never shows the studio-session id, in any text or label', async () => {
    const { renderer } = await show(base())
    await click(renderer, 'Preview')

    expect(everyLabel(renderer)).not.toContain(sessionId)
  })

  it('opens on the page asked for and moves the frame under the session when another is picked', async () => {
    mockParams.page = '/faq'
    const { renderer } = await show(base())
    expect(frameProps(renderer).source.uri).toBe(`${frameUrl}faq`)

    await click(renderer, 'Preview')
    await click(renderer, 'Page: Questions')
    // An option's name is its label and its group, as the sheet draws them.
    await clickLast(renderer, 'CartShop')

    expect(frameProps(renderer).source.uri).toBe(`${frameUrl}cart/`)
  })

  it('goes to the home page for a path that is not one', async () => {
    mockParams.page = 'https://evil.example/'
    const { renderer } = await show(base())

    expect(frameProps(renderer).source.uri).toBe(frameUrl)
  })
})

describe('the studio’s session', () => {
  it('opens one and renews it every 2 minutes with its own id', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await show(base())
      expect(asked(calls, 'query Studio(')[0]?.variables).toEqual({ s: null })

      await act(async () => void jest.advanceTimersByTime(119_000))
      expect(asked(calls, 'mutation Renew(')).toHaveLength(0)
      await act(async () => void jest.advanceTimersByTime(1_000))
      await settle()
      expect(asked(calls, 'mutation Renew(')).toHaveLength(1)
      expect(asked(calls, 'mutation Renew(')[0]?.variables).toEqual({ s: sessionId })

      await act(async () => void jest.advanceTimersByTime(120_000))
      await settle()
      expect(asked(calls, 'mutation Renew(')).toHaveLength(2)
      expect(frames(renderer)).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it.each(['SESSION_ENDED', 'FORBIDDEN'])('shows the session-ended state, with Reopen, when a renewal is refused (%s)', async (code) => {
    jest.useFakeTimers()
    try {
      let opened = 0
      const { renderer, calls } = await show(
        base({
          'query Studio(': () => {
            opened += 1
            return studioSession({ session: opened === 1 ? sessionId : 'SECONDSESSION0123456789' })
          },
          'mutation Renew(': () => {
            throw new ApiError(code, 'x')
          },
        }),
      )

      await act(async () => void jest.advanceTimersByTime(120_000))
      await settle()
      expect(hasText(renderer, 'Your studio session ended. Reopen the studio to keep designing.')).toBe(true)

      // Nothing else is renewed once it has ended.
      await act(async () => void jest.advanceTimersByTime(240_000))
      await settle()
      expect(asked(calls, 'mutation Renew(')).toHaveLength(1)

      await click(renderer, 'Reopen')
      expect(asked(calls, 'query Studio(')).toHaveLength(2)
      expect(asked(calls, 'query Studio(')[1]?.variables).toEqual({ s: null })
      expect(hasText(renderer, 'Your studio session ended. Reopen the studio to keep designing.')).toBe(false)
      expect(frameProps(renderer).source.uri).toContain('SECONDSESSION0123456789')
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps the frame when a renewal fails for some other reason, and tries again at the next', async () => {
    jest.useFakeTimers()
    try {
      let tries = 0
      const { renderer, calls } = await show(
        base({
          'mutation Renew(': () => {
            tries += 1
            if (tries === 1) throw new ApiError('NO_RESPONSE', 'x')
            return { renewStudioSession: 'ok' }
          },
        }),
      )

      await act(async () => void jest.advanceTimersByTime(120_000))
      await settle()
      expect(hasText(renderer, 'Your studio session ended.')).toBe(false)
      await act(async () => void jest.advanceTimersByTime(120_000))
      await settle()
      expect(asked(calls, 'mutation Renew(')).toHaveLength(2)
      expect(frames(renderer)).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('says it is opening, and where the studio stands in the queue, until the sandbox is ready', async () => {
    jest.useFakeTimers()
    try {
      let reads = 0
      const { renderer } = await show(
        base({
          'query Studio(': () => {
            reads += 1
            return reads === 1 ? studioSession({ state: 'starting' }) : reads === 2 ? studioSession({ state: 'queued', place: 2 }) : reads === 3 ? studioSession({ state: 'busy' }) : studioSession()
          },
        }),
      )
      await click(renderer, 'Preview')
      expect(hasText(renderer, 'Opening your studio…')).toBe(true)

      await act(async () => void jest.advanceTimersByTime(2_000))
      await settle()
      expect(hasText(renderer, 'You’re next — about 40 seconds')).toBe(true)

      await act(async () => void jest.advanceTimersByTime(2_000))
      await settle()
      expect(hasText(renderer, 'Finishing your previous change…')).toBe(true)

      await act(async () => void jest.advanceTimersByTime(2_000))
      await settle()
      expect(hasText(renderer, 'Opening your studio…')).toBe(false)
      expect(hasText(renderer, 'Finishing your previous change…')).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  it('says the studio couldn’t start when the sandbox is unavailable, and when it isn’t set up here', async () => {
    const unavailable = await show(base({ 'query Studio(': () => studioSession({ state: 'unavailable' }) }))
    expect(hasText(unavailable.renderer, 'The studio couldn’t start. Try again in a minute.')).toBe(true)

    const notConnected = await show(
      base({
        'query Studio(': () => {
          throw new ApiError('NOT_CONNECTED', 'x')
        },
      }),
    )
    expect(hasText(notConnected.renderer, 'The studio isn’t set up here yet.')).toBe(true)
  })
})

describe('the chat', () => {
  it('shows the conversation oldest first, what the AI changed, and Undo on the latest change', async () => {
    const { renderer } = await show(base())

    const shown = texts(renderer)
    expect(shown.indexOf('Make it warmer')).toBeLessThan(shown.indexOf('I warmed the background.'))
    expect(shown).toEqual(expect.arrayContaining(['Colours', 'You']))
    expect(hasButton(renderer, 'Undo this change')).toBe(true)
  })

  it('shows a note in words, drops one it does not know, and shows the error line', async () => {
    const { renderer } = await show(base({ designChat: () => chatOf([line('m4', 'error', ''), line('m3', 'note', 'template:linen'), line('m2', 'note', 'from-the-future'), line('m1', 'note', 'discarded')]) }))

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Switched to Linen', 'Changes discarded']))
    expect(hasText(renderer, 'from-the-future')).toBe(false)
    expect(hasText(renderer, 'I couldn’t make that change — nothing on your site changed. Try again, or say it a different way.')).toBe(true)
  })

  it('says so when there is nothing yet, and when the conversation cannot be loaded', async () => {
    const empty = await show(base({ designChat: () => chatOf([]) }))
    expect(hasText(empty.renderer, 'Tell me what to change and I’ll update the preview.')).toBe(true)

    const failed = await show(
      base({
        designChat: () => {
          throw new ApiError('NO_RESPONSE', 'x')
        },
      }),
    )
    expect(hasText(failed.renderer, 'We couldn’t load the conversation. Reopen the studio to try again.')).toBe(true)
  })

  it('asks for the page on screen as a phone sees it, clears the composer and shows the preview', async () => {
    let answered = false
    const { renderer, calls } = await show(
      base({
        'mutation Ask(': () => {
          answered = true
          return { askDesign: { outcome: 'changed' } }
        },
        designChat: () => (answered ? chatOf([line('m4', 'ai', 'Added a sale banner.', { changed: ['Banner'], canUndo: true }), line('m3', 'user', 'Add a sale banner')]) : chatOf()),
      }),
    )

    await type(renderer, 'Describe a change', 'Add a sale banner')
    await click(renderer, 'Send')

    expect(asked(calls, 'mutation Ask(')[0]?.variables).toEqual({ text: 'Add a sale banner', sample: null, page: '/', device: 'phone' })
    expect(hasText(renderer, 'Added a sale banner.')).toBe(true)
    expect(field(renderer, 'Describe a change').props.value).toBe('')
  })

  it('sends the website to take inspiration from, once it is a full https address', async () => {
    const { renderer, calls } = await show(base({ 'mutation Ask(': () => ({ askDesign: { outcome: 'changed' } }) }))

    await click(renderer, 'Add a website to take inspiration from')
    await type(renderer, 'Website address', 'example.com')
    await type(renderer, 'Describe a change', 'Like this')
    await click(renderer, 'Send')
    expect(asked(calls, 'mutation Ask(')).toHaveLength(0)
    expect(hasText(renderer, 'Type the full address, starting with https://')).toBe(true)

    await type(renderer, 'Website address', 'https://example.com/shop')
    await click(renderer, 'Send')
    expect(asked(calls, 'mutation Ask(')[0]?.variables).toEqual({ text: 'Like this', sample: 'https://example.com/shop', page: '/', device: 'phone' })
  })

  it('never sends an empty request', async () => {
    const { renderer, calls } = await show(base())

    await type(renderer, 'Describe a change', '   ')
    await click(renderer, 'Send')

    expect(asked(calls, 'mutation Ask(')).toHaveLength(0)
  })

  it('says “Checking your change…” while the change is made, and takes no second one', async () => {
    let release: () => void = () => undefined
    const pending = new Promise<unknown>((resolve) => (release = () => resolve({ askDesign: { outcome: 'changed' } })))
    const { renderer, calls } = await show(base({ 'mutation Ask(': () => pending }))

    await type(renderer, 'Describe a change', 'Add a sale banner')
    await click(renderer, 'Send')

    expect(hasText(renderer, 'Checking your change…')).toBe(true)
    expect(field(renderer, 'Describe a change').props.editable).toBe(false)
    expect(asked(calls, 'mutation Ask(')).toHaveLength(1)
    release()
    await settle()
    expect(hasText(renderer, 'Checking your change…')).toBe(false)
  })

  it.each([
    ['AI_BUDGET_REACHED', 'You’ve used this month’s AI requests.'],
    ['AI_NOT_CONNECTED', 'Add your AI key on the web portal to design with AI.'],
    ['INVALID_URL', 'Use a public website address starting with https://.'],
    ['SAMPLE_UNAVAILABLE', 'We couldn’t open that website. Try another address.'],
    ['STUDIO_QUEUED', 'The studio is waiting for room. Try again in a moment.'],
    ['FORBIDDEN', 'Only the store owner can change the storefront.'],
  ])('shows the refusal %s in words and keeps what was typed', async (code, words) => {
    const { renderer } = await show(
      base({
        'mutation Ask(': () => {
          throw new ApiError(code, 'x')
        },
      }),
    )

    await type(renderer, 'Describe a change', 'Add a sale banner')
    await click(renderer, 'Send')

    expect(hasText(renderer, words)).toBe(true)
    expect(field(renderer, 'Describe a change').props.value).toBe('Add a sale banner')
  })

  it('shows the session-ended state when the studio refuses a change because the session ended', async () => {
    const { renderer } = await show(
      base({
        'mutation Ask(': () => {
          throw new ApiError('SESSION_ENDED', 'x')
        },
      }),
    )

    await type(renderer, 'Describe a change', 'Add a sale banner')
    await click(renderer, 'Send')

    expect(hasText(renderer, 'Your studio session ended. Reopen the studio to keep designing.')).toBe(true)
    expect(hasButton(renderer, 'Reopen')).toBe(true)
  })

  it('keeps the words typed when the change could not be made, and reads the conversation again', async () => {
    const { renderer, calls } = await show(base({ 'mutation Ask(': () => ({ askDesign: { outcome: 'failed' } }) }))

    await type(renderer, 'Describe a change', 'Add a sale banner')
    await click(renderer, 'Send')

    expect(asked(calls, 'designChat').length).toBeGreaterThan(1)
    expect(field(renderer, 'Describe a change').props.value).toBe('Add a sale banner')
  })

  it('undoes the latest change by its message, and says a refusal by its code', async () => {
    const { renderer, calls } = await show(base({ 'mutation Undo(': () => ({ undoDesignChange: { id: 'm2' } }) }))
    await click(renderer, 'Undo this change')
    expect(asked(calls, 'mutation Undo(')[0]?.variables).toEqual({ id: 'm2' })

    const refused = await show(
      base({
        'mutation Undo(': () => {
          throw new ApiError('NOT_LATEST', 'x')
        },
      }),
    )
    await click(refused.renderer, 'Undo this change')
    expect(hasText(refused.renderer, 'Only your latest change can be undone.')).toBe(true)
  })

  it('takes no change while the sandbox is not ready', async () => {
    const { renderer, calls } = await show(base({ 'query Studio(': () => studioSession({ state: 'starting' }) }))

    await type(renderer, 'Describe a change', 'Add a sale banner')
    await click(renderer, 'Send')

    expect(asked(calls, 'mutation Ask(')).toHaveLength(0)
  })
})

describe('Publish', () => {
  const live = { storefront: { status: 'same_as_live', template: 'linen', live: { number: 4 }, draft: null, history: [{ number: 4 }, { number: 3 }] } }

  it('says what it does, follows the gate’s steps and tells the version is live', async () => {
    jest.useFakeTimers()
    let step = 'queued'
    let published = false
    const { renderer, calls } = await show(
      base({
        'storefront { status': () => (published && step === 'live' ? live : overviewOf()),
        'mutation { publishDesign }': () => {
          published = true
          return { publishDesign: 'run-1' }
        },
        'query Run(': () => ({ publishRun: { step, version: 4, checks: [], bisectMessageId: null } }),
      }),
    )

    await click(renderer, 'Publish')
    expect(hasText(renderer, 'Publish version 4?')).toBe(true)
    expect(hasText(renderer, 'We check your whole site first, then it goes live on juniper.my-store.one')).toBe(true)
    expect(hasText(renderer, 'You can go back to version 3 any time, for free.')).toBe(true)
    expect(asked(calls, 'publishDesign')).toHaveLength(0)
    await clickLast(renderer, 'Publish')

    expect(asked(calls, 'publishDesign')).toHaveLength(1)
    expect(hasText(renderer, 'Building your site…')).toBe(true)

    try {
      step = 'checking'
      await act(async () => void jest.advanceTimersByTime(2_000))
      await settle()
      expect(hasText(renderer, 'Checking your site…')).toBe(true)
      step = 'going_live'
      await act(async () => void jest.advanceTimersByTime(2_000))
      await settle()
      expect(hasText(renderer, 'Checking it went live…')).toBe(true)
      step = 'live'
      await act(async () => void jest.advanceTimersByTime(2_000))
      await settle()
    } finally {
      jest.useRealTimers()
    }
    expect(hasText(renderer, 'Version 4 is live — we checked your site and it changed')).toBe(true)
    expect(hasButton(renderer, 'Publish')).toBe(false)
  })

  it('says “Publish site” before the first publish', async () => {
    const { renderer } = await show(base({ 'storefront { status': () => overviewOf({ status: 'not_published', live: null, history: [] }) }))

    expect(hasButton(renderer, 'Publish site')).toBe(true)
  })

  it('offers no Publish while nothing waits', async () => {
    const { renderer } = await show(base({ 'storefront { status': () => live }))

    expect(hasButton(renderer, 'Publish')).toBe(false)
    expect(hasButton(renderer, 'Publish site')).toBe(false)
  })

  it('shows what failed in the checks’ own words, that the live site is unchanged, and offers everything before the change to blame', async () => {
    const { renderer, calls } = await show(
      base({
        designChat: () => chatOf([line('m5', 'ai', 'Added a buy bar.', { changed: ['Buy bar'], canUndo: true }), line('m4', 'user', 'Add a buy bar that stays at the bottom'), line('m1', 'user', 'Make it warmer')]),
        'mutation { publishDesign }': () => ({ publishDesign: 'run-1' }),
        'query Run(': () => ({ publishRun: { step: 'failed', version: 4, checks: [{ passed: false, words: 'On phones, the new buy bar covers the price.' }], bisectMessageId: 'm4' } }),
        'mutation Before(': () => ({ publishBefore: 'run-2' }),
      }),
    )

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')

    expect(hasText(renderer, 'Version 4 wasn’t published.')).toBe(true)
    expect(hasText(renderer, 'On phones, the new buy bar covers the price.')).toBe(true)
    expect(hasText(renderer, 'It started with this change: “Add a buy bar that stays at the bottom”.')).toBe(true)
    expect(hasText(renderer, 'Your live site hasn’t changed.')).toBe(true)

    await click(renderer, 'Publish everything before this change')
    expect(asked(calls, 'mutation Before(')).toHaveLength(0)
    await clickLast(renderer, 'Publish everything before')
    expect(asked(calls, 'mutation Before(')[0]?.variables).toEqual({ id: 'm4' })
  })

  it('offers no way back when no change is to blame, or the change is not in the conversation shown', async () => {
    const run = (bisect: string | null) =>
      base({
        'mutation { publishDesign }': () => ({ publishDesign: 'run-1' }),
        'query Run(': () => ({ publishRun: { step: 'failed', version: 4, checks: [{ passed: false, words: 'The checkout button can’t be reached.' }], bisectMessageId: bisect } }),
      })
    const none = await show(run(null))
    await click(none.renderer, 'Publish')
    await clickLast(none.renderer, 'Publish')
    expect(hasText(none.renderer, 'The checkout button can’t be reached.')).toBe(true)
    expect(hasButton(none.renderer, 'Publish everything before this change')).toBe(false)

    const missing = await show(run('m99'))
    await click(missing.renderer, 'Publish')
    await clickLast(missing.renderer, 'Publish')
    expect(hasButton(missing.renderer, 'Publish everything before this change')).toBe(false)
  })

  it('says a publish rolled back after going live, naming the version put back', async () => {
    const { renderer } = await show(
      base({
        'mutation { publishDesign }': () => ({ publishDesign: 'run-1' }),
        'query Run(': () => ({ publishRun: { step: 'rolled_back', version: 4, checks: [], bisectMessageId: null } }),
      }),
    )

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')

    expect(hasText(renderer, 'We put version 3 back: your new version didn’t pass our checks once it was live. We’re fixing it.')).toBe(true)
  })

  it('keeps the studio waiting, and says so, when a publish cannot be read', async () => {
    jest.useFakeTimers()
    try {
      const { renderer } = await show(
        base({
          'mutation { publishDesign }': () => ({ publishDesign: 'run-1' }),
          'query Run(': () => {
            throw new ApiError('NO_RESPONSE', 'x')
          },
        }),
      )

      await click(renderer, 'Publish')
      await clickLast(renderer, 'Publish')
      for (let i = 0; i < 6; i += 1) {
        await act(async () => void jest.advanceTimersByTime(2_000))
        await settle()
      }

      expect(hasText(renderer, 'We couldn’t read how your publish is going. The studio waits until we can, so nothing changes under it.')).toBe(true)
      expect(hasButton(renderer, 'Check again')).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it.each([
    ['PUBLISH_RUNNING', 'Wait for the publish in progress to finish.'],
    ['NOTHING_TO_PUBLISH', 'There are no changes to publish.'],
    ['READ_ONLY', 'Your store is view-only until the payment goes through.'],
    ['FORBIDDEN', 'Only the store owner can change the storefront.'],
  ])('shows the refusal %s in the sheet, in words', async (code, words) => {
    const { renderer } = await show(
      base({
        'mutation { publishDesign }': () => {
          throw new ApiError(code, 'x')
        },
      }),
    )

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')

    expect(hasText(renderer, words)).toBe(true)
    expect(hasText(renderer, 'Publish version 4?')).toBe(true)
  })

  it('takes no change while a publish runs', async () => {
    const { renderer, calls } = await show(
      base({
        'mutation { publishDesign }': () => ({ publishDesign: 'run-1' }),
        'query Run(': () => ({ publishRun: { step: 'checking', version: 4, checks: [], bisectMessageId: null } }),
      }),
    )

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')
    await type(renderer, 'Describe a change', 'Add a sale banner')
    await click(renderer, 'Send')

    expect(asked(calls, 'mutation Ask(')).toHaveLength(0)
  })
})

describe('Discard and Open preview', () => {
  it('asks before it discards the draft, and says the live site is unchanged', async () => {
    const { renderer, calls } = await show(base({ 'mutation { discardDraft }': () => ({ discardDraft: true }) }))

    await click(renderer, 'Discard')
    expect(hasText(renderer, 'Discard this draft?')).toBe(true)
    expect(asked(calls, 'discardDraft')).toHaveLength(0)
    await clickLast(renderer, 'Discard draft')

    expect(asked(calls, 'discardDraft')).toHaveLength(1)
    expect(hasText(renderer, 'Draft thrown away')).toBe(true)
  })

  it('hands the signed webpreview.store link to the phone’s browser and shows it nowhere', async () => {
    const link = 'https://juniper.webpreview.store/__open?t=SECRETTOKEN'
    const { renderer } = await show(base({ 'mutation { previewLink }': () => ({ previewLink: link }) }))

    await click(renderer, 'Open preview ↗')

    expect(openURL).toHaveBeenCalledTimes(1)
    expect(openURL).toHaveBeenCalledWith(link)
    expect(everyLabel(renderer)).not.toContain('SECRETTOKEN')
  })

  it('opens nothing for a link that is not https, and says a refusal by its code', async () => {
    const bad = await show(base({ 'mutation { previewLink }': () => ({ previewLink: 'javascript:alert(1)' }) }))
    await click(bad.renderer, 'Open preview ↗')
    expect(openURL).not.toHaveBeenCalled()
    expect(hasText(bad.renderer, 'The phone couldn’t open the browser. Try again.')).toBe(true)

    const refused = await show(
      base({
        'mutation { previewLink }': () => {
          throw new ApiError('SUPPORT_READ_ONLY', 'x')
        },
      }),
    )
    await click(refused.renderer, 'Open preview ↗')
    expect(hasText(refused.renderer, 'Support can’t change the storefront.')).toBe(true)
    expect(openURL).not.toHaveBeenCalled()
  })

  it('offers neither without a draft', async () => {
    const { renderer } = await show(base({ 'storefront { status': () => overviewOf({ status: 'same_as_live', draft: null }) }))

    expect(hasButton(renderer, 'Discard')).toBe(false)
    expect(hasButton(renderer, 'Open preview ↗')).toBe(false)
  })
})

describe('who gets the studio', () => {
  it('tells a Manager it has no access, before any session is opened', async () => {
    const { renderer, calls } = await show(base({ 'acting { permissions': () => access(manager) }), 'manager')

    expect(frames(renderer)).toHaveLength(0)
    expect(asked(calls, 'query Studio(')).toHaveLength(0)
    expect(hasButton(renderer, 'Send')).toBe(false)
  })

  it('shows no studio once the shell reports the store view-only for payment, since it takes no change', async () => {
    const { client } = fakeApi(base())
    mockSession.client = client
    const renderer = await renderShell(<StudioScreen />, { acting: actingAs('owner'), client: fakeClient({ state: readOnlyState }) })
    await settle()

    expect(frames(renderer)).toHaveLength(0)
    expect(hasButton(renderer, 'Send')).toBe(false)
  })

  it('shows a failed read as a designed state with a way to try again', async () => {
    const { renderer } = await show(
      base({
        'storefront { status': () => {
          throw new ApiError('NO_RESPONSE', 'x')
        },
      }),
    )

    expect(frames(renderer)).toHaveLength(0)
    expect(hasButton(renderer, 'Try again')).toBe(true)
  })
})
