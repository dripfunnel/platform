import type { ReactElement } from 'react'
import { Linking } from 'react-native'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { StorefrontScreen } from './StorefrontScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }
const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ dispatch: jest.fn() }),
}))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../graphql/partnerDomain', () => ({ partnerDomain: () => 'shop.test' }))
jest.mock('../../session', () => ({
  sessionClient: () => mockSession.client,
  designClient: () => mockSession.client,
  session: () => ({ leaveStore: jest.fn(), end: jest.fn() }),
}))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const owner = ['storefront.read', 'publish']
const manager = ['storefront.read']
const access = (permissions: string[]) => ({ me: { acting: { permissions, seller: null } } })

const version = (number: number, over: Record<string, unknown> = {}) => ({ id: `ver-${number}`, number, template: 'linen', label: `Change ${number}`, live: false, publishedAt: '2026-10-08T10:00:00Z', ...over })
const overviewOf = (over: Record<string, unknown> = {}) => ({
  storefront: {
    status: 'same_as_live',
    live: { number: 3 },
    draft: null,
    lastPublish: { state: 'live' },
    history: [version(3, { live: true, label: 'Warmer colours' }), version(2, { label: 'Sale banner' }), version(1, { label: 'First site' })],
    ...over,
  },
})
const draft = { previewReady: true }
const previewUrl = 'https://abcdefghij.webpreview.store/__open?t=SECRETTOKEN'

const base = (over: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(owner),
  'storefront { status': () => overviewOf(),
  storefrontDomains: () => ({ storefrontDomains: { domains: [{ host: 'juniper.my-store.one', primary: true }] } }),
  designChat: () => ({ designChat: { messages: [{ role: 'ai', text: 'Done.' }, { role: 'user', text: 'Make the colours warmer' }] } }),
  '{ storeInfo { timeZone': () => ({ storeInfo: { timeZone: 'Asia/Kolkata' } }),
  ...over,
})
const withDraft = (over: Handlers = {}): Handlers => base({ 'storefront { status': () => overviewOf({ status: 'unpublished_changes', draft }), ...over })

const show = async (element: ReactElement, handlers: Handlers) => {
  const { client, calls } = fakeApi(handlers)
  mockSession.client = client
  const renderer = await renderShell(element, { acting: actingAs('owner') })
  await settle()
  return { renderer, calls }
}

const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
// The last button of that name is the one in the sheet that opened over the screen.
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  const found = pressablesNamed(renderer, label).at(-1)
  if (!found) throw new Error(`nothing to press named "${label}"`)
  await press(found)
  await settle()
}
const hasButton = (renderer: ReactTestRenderer, label: string) => pressablesNamed(renderer, label).length > 0
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const typePrompt = async (renderer: ReactTestRenderer, value: string) => {
  const field = renderer.root.findAll((node) => node.props.accessibilityLabel === 'What would you like to change?' && typeof node.props.onChangeText === 'function')[0]
  if (!field) throw new Error('no prompt field')
  await act(async () => field.props.onChangeText(value))
}

const openURL = jest.spyOn(Linking, 'openURL')

beforeEach(() => {
  jest.clearAllMocks()
  openURL.mockResolvedValue(true)
  resetScenario()
})

describe('the live shop', () => {
  it('shows the address, that it is live and its last change, with View opening it in the browser', async () => {
    const { renderer } = await show(<StorefrontScreen />, base())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Storefront', 'juniper.my-store.one', 'Live', 'Last change: Warmer colours']))
    await press(pressableNamed(renderer, 'View'))
    expect(openURL).toHaveBeenCalledWith('https://juniper.my-store.one')
  })

  it('lists the recent versions with their dates, and Restore on the older ones only', async () => {
    const { renderer } = await show(<StorefrontScreen />, base())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Recent versions', 'Warmer colours', 'v3 · Oct 8, 2026', 'Sale banner', 'v2 · Oct 8, 2026', 'First site']))
    expect(hasButton(renderer, 'Restore version 2')).toBe(true)
    expect(hasButton(renderer, 'Restore version 1')).toBe(true)
    expect(hasButton(renderer, 'Restore version 3')).toBe(false)
  })

  it('says a shop not yet published is not published and offers no View', async () => {
    const { renderer } = await show(<StorefrontScreen />, base({ 'storefront { status': () => overviewOf({ status: 'not_published', live: null, history: [] }) }))

    expect(hasText(renderer, 'Not published yet')).toBe(true)
    expect(hasButton(renderer, 'View')).toBe(false)
    expect(hasButton(renderer, 'Make a draft')).toBe(true)
  })

  it('points a store with no site yet to the web portal, and one being made says so', async () => {
    const none = await show(<StorefrontScreen />, base({ 'storefront { status': () => overviewOf({ status: 'not_started', live: null, history: [] }) }))
    expect(hasText(none.renderer, 'Your shop’s site isn’t set up yet')).toBe(true)
    expect(hasButton(none.renderer, 'Make a draft')).toBe(false)
    expect(hasButton(none.renderer, 'Templates and the full designer')).toBe(true)

    const creating = await show(<StorefrontScreen />, base({ 'storefront { status': () => overviewOf({ status: 'creating', live: null, history: [] }) }))
    expect(hasText(creating.renderer, 'Your site is being made')).toBe(true)
  })
})

describe('a seat that can only look', () => {
  it('sees the Manager’s view-only screen: no Change something, Publish or Restore', async () => {
    const { renderer } = await show(<StorefrontScreen />, withDraft({ 'acting { permissions': () => access(manager) }))

    expect(hasText(renderer, 'You can look but not change the shop. Ask the store owner if something needs updating.')).toBe(true)
    expect(hasButton(renderer, 'Make a draft')).toBe(false)
    expect(hasText(renderer, 'Change something')).toBe(false)
    expect(hasButton(renderer, 'Publish')).toBe(false)
    expect(hasButton(renderer, 'Discard')).toBe(false)
    expect(hasButton(renderer, 'Restore version 2')).toBe(false)
    expect(hasButton(renderer, 'View')).toBe(true)
    expect(hasButton(renderer, 'Templates and the full designer')).toBe(true)
  })

  it('tells a seat with no Storefront it has no access, before reading anything', async () => {
    const { renderer, calls } = await show(<StorefrontScreen />, base({ 'acting { permissions': () => access([]) }))

    expect(hasText(renderer, 'Make a draft')).toBe(false)
    expect(asked(calls, 'storefront {')).toHaveLength(0)
  })

  it('draws a load failure as the shell’s "couldn’t load" state', async () => {
    const { renderer } = await show(<StorefrontScreen />, base({ 'storefront { status': () => { throw new ApiError('NO_RESPONSE', 'x') } }))

    expect(texts(renderer).some((text) => text.includes('couldn’t load'))).toBe(true)
  })
})

describe('Change something', () => {
  it('sends the words as a phone-sized request and shows the draft that comes back', async () => {
    let drafted = false
    const { renderer, calls } = await show(
      <StorefrontScreen />,
      base({
        'storefront { status': () => (drafted ? overviewOf({ status: 'unpublished_changes', draft }) : overviewOf()),
        'mutation Ask(': () => {
          drafted = true
          return { askDesign: { outcome: 'changed', message: { text: 'Made the colours warmer.' } } }
        },
      }),
    )

    await typePrompt(renderer, '  Make the colours warmer  ')
    await click(renderer, 'Make a draft')

    expect(asked(calls, 'askDesign')[0]?.variables).toEqual({ text: 'Make the colours warmer', page: '/', device: 'phone' })
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Draft ready', '“Make the colours warmer”', 'Preview the draft', 'Discard', 'Publish', 'Draft ready — check it, then publish']))
    expect(hasButton(renderer, 'Make a draft')).toBe(false)
  })

  it('says the draft is being made while the designer works, and holds the button', async () => {
    let release: () => void = () => undefined
    const pending = new Promise<unknown>((resolve) => (release = () => resolve({ askDesign: { outcome: 'changed', message: null } })))
    const { renderer } = await show(<StorefrontScreen />, base({ 'mutation Ask(': () => pending }))

    await typePrompt(renderer, 'Add a sale banner')
    await click(renderer, 'Make a draft')

    expect(hasText(renderer, 'Making your draft…')).toBe(true)
    expect(pressableNamed(renderer, 'Make a draft').findAll((node) => typeof node.props.accessibilityState?.disabled === 'boolean')[0]?.props.accessibilityState.disabled).toBe(true)
    expect(hasText(renderer, 'This can take a minute. Keep this screen open.')).toBe(true)
    release()
    await settle()
  })

  it('starts a prompt from an idea', async () => {
    const { renderer } = await show(<StorefrontScreen />, base())

    await press(pressableNamed(renderer, 'Add a sale banner'))
    const field = renderer.root.findAll((node) => node.props.accessibilityLabel === 'What would you like to change?' && typeof node.props.onChangeText === 'function')[0]
    expect(field?.props.value).toBe('Add a sale banner')
  })

  it('asks for words first and never sends an empty request', async () => {
    const { renderer, calls } = await show(<StorefrontScreen />, base())

    await click(renderer, 'Make a draft')

    expect(hasText(renderer, 'Say what you’d like to change')).toBe(true)
    expect(asked(calls, 'askDesign')).toHaveLength(0)
  })

  it.each([
    ['AI_BUDGET_REACHED', 'You’ve used this month’s AI requests.'],
    ['BRAND_NOT_READY', 'Add your shop name and logo first, on the web portal.'],
    ['STUDIO_UNAVAILABLE', 'The studio couldn’t start. Try again in a minute.'],
    ['FORBIDDEN', 'Only the store owner can change the storefront.'],
  ])('shows the API’s refusal %s in words and keeps what was typed', async (code, words) => {
    const { renderer } = await show(<StorefrontScreen />, base({ 'mutation Ask(': () => { throw new ApiError(code, 'x') } }))

    await typePrompt(renderer, 'Add a sale banner')
    await click(renderer, 'Make a draft')

    expect(hasText(renderer, words)).toBe(true)
    expect(hasButton(renderer, 'Make a draft')).toBe(true)
  })

  it('says nothing changed when the designer declines or fails', async () => {
    const declined = await show(<StorefrontScreen />, base({ 'mutation Ask(': () => ({ askDesign: { outcome: 'unchanged', message: { text: 'Your theme has no prices to move.' } } }) }))
    await typePrompt(declined.renderer, 'Move the prices')
    await click(declined.renderer, 'Make a draft')
    expect(hasText(declined.renderer, 'Nothing was changed. Your theme has no prices to move.')).toBe(true)

    const failed = await show(<StorefrontScreen />, base({ 'mutation Ask(': () => ({ askDesign: { outcome: 'failed', message: null } }) }))
    await typePrompt(failed.renderer, 'Move the prices')
    await click(failed.renderer, 'Make a draft')
    expect(hasText(failed.renderer, 'I couldn’t make that change — nothing on your shop changed.')).toBe(true)
  })
})

describe('Preview', () => {
  it('hands the signed webpreview.store link to the phone’s browser and shows it nowhere', async () => {
    const { renderer, calls } = await show(<StorefrontScreen />, withDraft({ 'mutation { previewLink }': () => ({ previewLink: previewUrl }) }))

    await click(renderer, 'Preview the draft')

    expect(asked(calls, 'previewLink')).toHaveLength(1)
    expect(openURL).toHaveBeenCalledTimes(1)
    expect(openURL).toHaveBeenCalledWith(previewUrl)
    expect(JSON.stringify(texts(renderer))).not.toContain('SECRETTOKEN')
  })

  it('opens nothing for a link that is not https', async () => {
    const { renderer } = await show(<StorefrontScreen />, withDraft({ 'mutation { previewLink }': () => ({ previewLink: 'javascript:alert(1)' }) }))

    await click(renderer, 'Preview the draft')

    expect(openURL).not.toHaveBeenCalled()
    expect(hasText(renderer, 'The phone couldn’t open the browser. Try again.')).toBe(true)
  })

  it('waits for a preview that is not ready, and says a refusal by its code', async () => {
    const waiting = await show(<StorefrontScreen />, withDraft({ 'storefront { status': () => overviewOf({ status: 'unpublished_changes', draft: { previewReady: false } }) }))
    await click(waiting.renderer, 'Preview the draft')
    expect(hasText(waiting.renderer, 'The preview is still being made. Try again in a moment.')).toBe(true)
    expect(openURL).not.toHaveBeenCalled()

    const refused = await show(<StorefrontScreen />, withDraft({ 'mutation { previewLink }': () => { throw new ApiError('SUPPORT_READ_ONLY', 'x') } }))
    await click(refused.renderer, 'Preview the draft')
    expect(hasText(refused.renderer, 'Support can’t change the storefront.')).toBe(true)
    expect(openURL).not.toHaveBeenCalled()
  })
})

describe('Discard', () => {
  it('asks first, then throws the draft away', async () => {
    let discarded = false
    const { renderer, calls } = await show(
      <StorefrontScreen />,
      withDraft({
        'storefront { status': () => (discarded ? overviewOf() : overviewOf({ status: 'unpublished_changes', draft })),
        'mutation { discardDraft }': () => {
          discarded = true
          return { discardDraft: true }
        },
      }),
    )

    await click(renderer, 'Discard')
    expect(hasText(renderer, 'Discard this draft?')).toBe(true)
    expect(asked(calls, 'discardDraft')).toHaveLength(0)
    await clickLast(renderer, 'Discard draft')

    expect(asked(calls, 'discardDraft')).toHaveLength(1)
    expect(hasText(renderer, 'Draft thrown away')).toBe(true)
    expect(hasButton(renderer, 'Make a draft')).toBe(true)
  })
})

describe('Publish', () => {
  const published = (over: Handlers = {}): Handlers => {
    let live = false
    return withDraft({
      'storefront { status': () => (live ? overviewOf({ live: { number: 4 }, history: [version(4, { live: true, label: 'Warmer colours' }), version(3), version(2)] }) : overviewOf({ status: 'unpublished_changes', draft })),
      'mutation { publishDesign }': () => ({ publishDesign: 'run-1' }),
      'publishRun(': () => {
        live = true
        return { publishRun: { step: 'live', version: 4, checks: [] } }
      },
      'goBackToVersion': () => ({ goBackToVersion: true }),
      ...over,
    })
  }

  it('states its consequence first, then checks the site and offers Undo that goes back to the version before', async () => {
    const { renderer, calls } = await show(<StorefrontScreen />, published())

    await click(renderer, 'Publish')
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        'Publish version 4?',
        'We check your whole site first, then it goes live on juniper.my-store.one in a few minutes and uses a few build minutes. You can go back to version 3 any time, for free.',
      ]),
    )
    expect(asked(calls, 'publishDesign')).toHaveLength(0)
    await clickLast(renderer, 'Publish')

    expect(asked(calls, 'publishDesign')).toHaveLength(1)
    expect(asked(calls, 'publishRun')[0]?.variables).toEqual({ id: 'run-1' })
    expect(hasText(renderer, 'Published — shoppers see it now')).toBe(true)

    await click(renderer, 'Undo')

    expect(asked(calls, 'goBackToVersion')[0]?.variables).toEqual({ number: 3 })
    expect(hasText(renderer, 'Undone — your shop is back on version 3')).toBe(true)
  })

  it('says which step it is on while the checks run, and holds the buttons', async () => {
    const { renderer } = await show(<StorefrontScreen />, published({ 'publishRun(': () => ({ publishRun: { step: 'checking', version: null, checks: [] } }) }))

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')

    expect(hasText(renderer, 'Checking your site…')).toBe(true)
    expect(pressableNamed(renderer, 'Publish').findAll((node) => typeof node.props.accessibilityState?.disabled === 'boolean')[0]?.props.accessibilityState.disabled).toBe(true)
  })

  it('says what failed in the checks’ words and that the live site has not changed', async () => {
    const { renderer } = await show(
      <StorefrontScreen />,
      published({ 'publishRun(': () => ({ publishRun: { step: 'failed', version: null, checks: [{ passed: true, words: null }, { passed: false, words: 'The checkout broke on phones.' }] } }) }),
    )

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')

    expect(hasText(renderer, 'Version 4 wasn’t published. The checkout broke on phones. Your live site hasn’t changed.')).toBe(true)
    expect(hasButton(renderer, 'Publish')).toBe(true)
  })

  it('says a publish put back after it went live', async () => {
    const { renderer } = await show(<StorefrontScreen />, published({ 'publishRun(': () => ({ publishRun: { step: 'rolled_back', version: null, checks: [] } }) }))

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')

    expect(hasText(renderer, 'We put version 3 back')).toBe(true)
  })

  it('keeps the sheet open with the refusal in words', async () => {
    const { renderer } = await show(<StorefrontScreen />, published({ 'mutation { publishDesign }': () => { throw new ApiError('PUBLISH_RUNNING', 'x') } }))

    await click(renderer, 'Publish')
    await clickLast(renderer, 'Publish')

    expect(hasText(renderer, 'Wait for the publish in progress to finish.')).toBe(true)
    expect(hasText(renderer, 'Publish version 4?')).toBe(true)
  })

  it('names a last publish that went wrong while the draft is still there', async () => {
    const { renderer } = await show(<StorefrontScreen />, withDraft({ 'storefront { status': () => overviewOf({ status: 'unpublished_changes', draft, lastPublish: { state: 'failed' } }) }))

    expect(hasText(renderer, 'Your last publish didn’t go live. Your live site hasn’t changed.')).toBe(true)
  })

  it('offers a first publish no version to go back to', async () => {
    const { renderer } = await show(
      <StorefrontScreen />,
      withDraft({ 'storefront { status': () => overviewOf({ status: 'unpublished_changes', draft, live: null, history: [] }) }),
    )

    await click(renderer, 'Publish')

    expect(hasText(renderer, 'Publish version 1?')).toBe(true)
    expect(texts(renderer).some((text) => text.includes('You can go back'))).toBe(false)
  })
})

describe('Restore', () => {
  it('asks first, then puts the chosen version live by going back to it', async () => {
    const { renderer, calls } = await show(<StorefrontScreen />, base({ goBackToVersion: () => ({ goBackToVersion: true }) }))

    await click(renderer, 'Restore version 2')
    expect(hasText(renderer, 'Go back to “Sale banner”?')).toBe(true)
    expect(asked(calls, 'goBackToVersion')).toHaveLength(0)
    await clickLast(renderer, 'Restore it')

    expect(asked(calls, 'goBackToVersion')[0]?.variables).toEqual({ number: 2 })
    expect(hasText(renderer, 'Restored — shoppers see it now')).toBe(true)
  })

  it('says why a version can’t be restored', async () => {
    const { renderer } = await show(<StorefrontScreen />, base({ goBackToVersion: () => { throw new ApiError('BUILD_GONE', 'x') } }))

    await click(renderer, 'Restore version 1')
    await clickLast(renderer, 'Restore it')

    expect(hasText(renderer, 'That version can’t be restored any more.')).toBe(true)
  })
})

describe('Best on the web', () => {
  it('opens the web portal’s storefront on the partner’s host in the phone’s browser', async () => {
    const { renderer } = await show(<StorefrontScreen />, base())

    await click(renderer, 'Templates and the full designer')
    expect(hasText(renderer, 'Best on a bigger screen')).toBe(true)
    await clickLast(renderer, 'Open the web portal')

    expect(openURL).toHaveBeenCalledWith('https://shop.test/storefront')
  })

  it('opens the full designer in the app from "Open here anyway", and the browser not at all', async () => {
    const { renderer } = await show(<StorefrontScreen />, base())

    await click(renderer, 'Templates and the full designer')
    await clickLast(renderer, 'Open here anyway')

    expect(openURL).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/more/storefront/designer')
  })
})
