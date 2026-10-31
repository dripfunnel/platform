import { Linking } from 'react-native'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../../testing/fakeApi'
import { actingAs, byRole, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../../testing/harness'
import { resetScenario } from '../../states/scenario'
import { DesignerScreen } from './DesignerScreen'

jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }
const mockPush = jest.fn()
const mockPick = jest.fn()
const mockUpload = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ dispatch: jest.fn() }),
  useFocusEffect: jest.fn(),
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../../graphql/partnerDomain', () => ({ partnerDomain: () => 'shop.test' }))
jest.mock('../../products/files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({ authorization: 'Bearer token' }) }) }))
jest.mock('../../products/pickPhoto', () => ({ pickFromLibrary: (...args: unknown[]) => mockPick(...args) }))
jest.mock('../../../api/products', () => ({ ...jest.requireActual('../../../api/products'), uploadPhoto: (...args: unknown[]) => mockUpload(...args) }))
jest.mock('../../../session', () => ({
  sessionClient: () => mockSession.client,
  designClient: () => mockSession.client,
  session: () => ({ leaveStore: jest.fn(), end: jest.fn() }),
}))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const owner = ['storefront.read', 'publish']
const manager = ['storefront.read']
const access = (permissions: string[]) => ({ me: { acting: { permissions, seller: null } } })
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const overviewOf = (over: Record<string, unknown> = {}) => ({ storefront: { status: 'same_as_live', template: 'linen', live: { number: 3 }, draft: null, history: [{ number: 3 }, { number: 2 }], ...over } })
const noSite = overviewOf({ status: 'not_started', template: null, live: null, history: [] })
const templates = [
  { key: 'baseline', name: 'Baseline', tag: 'Plain', description: 'Nothing but the basics.', demoUrl: null, current: false },
  { key: 'linen', name: 'Linen', tag: 'Warm', description: 'Soft and earthy.', demoUrl: 'https://demo.example/linen', current: true },
  { key: 'noir', name: 'Noir', tag: 'Bold', description: 'High contrast.', demoUrl: 'http://demo.example/noir', current: false },
]
const noSocial = { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null }
const brandOf = (over: Record<string, unknown> = {}) => ({ storefrontBrand: { brandReady: true, shopName: 'Juniper & Co.', logoAssetId: 'logo-1', faviconAssetId: null, primaryColour: null, secondaryColour: null, tagline: 'Handloom from Jaipur', description: null, social: noSocial, contactEmail: 'hello@juniper.test', contactPhone: null, contactAddress: null, voice: null, ...over } })
const unreadyBrand = brandOf({ brandReady: false, shopName: '', logoAssetId: null, tagline: null, contactEmail: 'hello@juniper.test' })
const seoOf = (over: Record<string, unknown> = {}) => ({ storefrontSeo: { title: 'Juniper & Co. — handloom', description: 'Hand-woven cottons.', shareImageAssetId: null, ...over } })

const base = (over: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(owner),
  'storefront { status': () => overviewOf(),
  storefrontDomains: () => ({ storefrontDomains: { domains: [{ host: 'juniper.my-store.one', primary: true }] } }),
  storefrontTemplates: () => ({ storefrontTemplates: templates }),
  storefrontBrand: () => brandOf(),
  storefrontSeo: () => seoOf(),
  'query Recent(': () => ({ products: { nodes: [{ id: 'p1', photoUrl: 'x' }] } }),
  'query Photos(': () => ({ p0: { photos: [{ assetId: 'photo-1' }] } }),
  ...over,
})

const show = async (handlers: Handlers, role = 'owner', shellState: unknown = null) => {
  const { client, calls } = fakeApi(handlers)
  mockSession.client = client
  const renderer = await renderShell(<DesignerScreen />, { acting: actingAs(role), client: fakeClient({ state: shellState }) })
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
const disabled = (renderer: ReactTestRenderer, label: string): boolean => pressableNamed(renderer, label).findAll((node) => typeof node.props.accessibilityState?.disabled === 'boolean')[0]?.props.accessibilityState.disabled === true

const openURL = jest.spyOn(Linking, 'openURL')

beforeEach(() => {
  jest.clearAllMocks()
  openURL.mockResolvedValue(true)
  mockPick.mockResolvedValue([{ uri: 'file:///logo.png', mimeType: 'image/png' }])
  mockUpload.mockResolvedValue('logo-new')
  resetScenario()
})

describe('Your brand', () => {
  const brandStep = (over: Handlers = {}) => base({ storefrontBrand: () => unreadyBrand, storefrontSeo: () => seoOf({ title: null, description: null }), ...over })

  it('replaces the whole page for the Owner until the shop name and logo are saved, and holds Continue until both are', async () => {
    const { renderer } = await show(brandStep())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Your brand', 'Name and logo', 'Public contact']))
    expect(hasButton(renderer, 'Design')).toBe(false)
    expect(disabled(renderer, 'Continue to templates')).toBe(true)
    expect(hasText(renderer, 'Add your shop name and logo to continue.')).toBe(true)

    await type(renderer, 'Shop name', 'Juniper & Co.')
    expect(disabled(renderer, 'Continue to templates')).toBe(true)
    await click(renderer, 'Choose from your photos')
    expect(mockUpload).toHaveBeenCalledWith(expect.anything(), { uri: 'file:///logo.png', mimeType: 'image/png' })
    expect(disabled(renderer, 'Continue to templates')).toBe(false)
  })

  it('fills the public contact from what the API holds, and sends every field of the brand when it continues', async () => {
    let ready = false
    const { renderer, calls } = await show(
      brandStep({
        'mutation Brand(': () => {
          ready = true
          return { saveStorefrontBrand: brandOf().storefrontBrand }
        },
        storefrontBrand: () => (ready ? brandOf() : unreadyBrand),
        'storefront { status': () => (ready ? noSite : noSite),
      }),
    )
    expect(field(renderer, 'Email').props.value).toBe('hello@juniper.test')

    await type(renderer, 'Shop name', '  Juniper & Co.  ')
    await click(renderer, 'Choose from your photos')
    await type(renderer, 'Tagline', 'Handloom from Jaipur')
    await type(renderer, 'Instagram', '@juniper')
    await type(renderer, 'Primary colour', '#1D6B47')
    await click(renderer, 'Warm and friendly')
    await click(renderer, 'Continue to templates')

    expect(asked(calls, 'mutation Brand(')[0]?.variables).toEqual({
      input: {
        shopName: 'Juniper & Co.',
        logoAssetId: 'logo-new',
        faviconAssetId: null,
        primaryColour: '#1D6B47',
        secondaryColour: null,
        tagline: 'Handloom from Jaipur',
        description: '',
        social: { instagram: '@juniper', facebook: '', x: '', youtube: '', tiktok: '', whatsapp: '' },
        contactEmail: 'hello@juniper.test',
        contactPhone: '',
        contactAddress: { street: '', city: '', postal: '', region: '' },
        voice: 'Warm and friendly',
      },
    })
    expect(hasText(renderer, 'Choose a starting point')).toBe(true)
  })

  it('saves the home page’s words first, then the brand, and leaves the share image as it was', async () => {
    const order: string[] = []
    const { renderer, calls } = await show(
      brandStep({
        storefrontSeo: () => seoOf({ title: null, description: null, shareImageAssetId: 'share-1' }),
        'mutation Seo(': () => {
          order.push('seo')
          return { saveStorefrontSeo: { title: 'Juniper', description: 'Cottons', shareImageAssetId: 'share-1' } }
        },
        'mutation Brand(': () => {
          order.push('brand')
          return { saveStorefrontBrand: brandOf().storefrontBrand }
        },
      }),
    )

    await type(renderer, 'Shop name', 'Juniper')
    await click(renderer, 'Choose from your photos')
    await type(renderer, 'Home page title', 'Juniper')
    await type(renderer, 'Home page description', 'Cottons')
    await click(renderer, 'Continue to templates')

    expect(order).toEqual(['seo', 'brand'])
    expect(asked(calls, 'mutation Seo(')[0]?.variables).toEqual({ input: { title: 'Juniper', description: 'Cottons', shareImageAssetId: 'share-1' } })
  })

  it('says a refusal at the field it names, and keeps what was typed', async () => {
    const { renderer } = await show(
      brandStep({
        'mutation Brand(': () => {
          throw new ApiError('INVALID_INPUT', 'x', { field: 'primaryColour' })
        },
      }),
    )

    await type(renderer, 'Shop name', 'Juniper')
    await click(renderer, 'Choose from your photos')
    await type(renderer, 'Primary colour', 'green')
    await click(renderer, 'Continue to templates')

    expect(hasText(renderer, 'Use a colour like #1D6B47.')).toBe(true)
    expect(field(renderer, 'Primary colour').props.value).toBe('green')
    expect(field(renderer, 'Shop name').props.value).toBe('Juniper')
  })

  it.each([
    ['INVALID_EMAIL', {}, 'That doesn’t look like an email address.'],
    ['INVALID_IMAGE', {}, 'Use an image you uploaded to this store.'],
    ['FORBIDDEN', {}, 'Only the store owner can change the storefront.'],
    ['INVALID_INPUT', { field: 'social.x' }, 'Use your X handle, or your profile’s address on X.'],
    ['NO_RESPONSE', {}, 'That didn’t save. Check your connection and try again.'],
  ])('words the refusal %s', async (code, details, words) => {
    const { renderer } = await show(
      brandStep({
        'mutation Brand(': () => {
          throw new ApiError(code, 'x', details)
        },
      }),
    )

    await type(renderer, 'Shop name', 'Juniper')
    await click(renderer, 'Choose from your photos')
    await click(renderer, 'Continue to templates')

    expect(hasText(renderer, words)).toBe(true)
  })

  it('says why a logo did not upload, by the refusal’s code, and keeps the page', async () => {
    mockUpload.mockRejectedValueOnce(new ApiError('TOO_LARGE', 'x'))
    const { renderer } = await show(brandStep())

    await click(renderer, 'Choose from your photos')

    expect(hasText(renderer, 'That photo is too big. Use one under 20 MB.')).toBe(true)
    expect(disabled(renderer, 'Continue to templates')).toBe(true)
  })

  it('never shows to a reader, who sees the storefront as it is', async () => {
    const { renderer, calls } = await show(base({ 'acting { permissions': () => access(manager), storefrontBrand: () => unreadyBrand }), 'manager')

    expect(hasText(renderer, 'Your brand')).toBe(false)
    expect(asked(calls, 'storefrontBrand')).toHaveLength(0)
    expect(hasButton(renderer, 'Design')).toBe(true)
  })
})

describe('the template gallery', () => {
  it('asks the Owner to pick one when no site exists, and the first pick asks nothing about words', async () => {
    const { renderer, calls } = await show(base({ 'storefront { status': () => noSite, 'mutation Pick(': () => ({ chooseTemplate: 'creating' }) }))

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Choose a starting point', 'Start from scratch', 'Linen', 'Noir', 'Soft and earthy.', 'Your current look']))
    expect(hasButton(renderer, '← Back to Storefront')).toBe(false)
    await press(pressablesNamed(renderer, 'Use this template')[1] as ReactTestInstance)
    await settle()

    expect(asked(calls, 'mutation Pick(')[0]?.variables).toEqual({ key: 'linen', keep: true })
    expect(hasText(renderer, 'Keep my words')).toBe(false)
  })

  it('opens a demo only at an https address', async () => {
    const { renderer } = await show(base({ 'storefront { status': () => noSite }))

    expect(pressablesNamed(renderer, 'View demo ↗')).toHaveLength(1)
    await press(pressableNamed(renderer, 'View demo ↗'))
    expect(openURL).toHaveBeenCalledWith('https://demo.example/linen')
  })

  it('shows the site being made, reads its status every 5 seconds and shows the Design tab once it is there', async () => {
    jest.useFakeTimers()
    try {
      let status = 'creating'
      const { renderer, calls } = await show(base({ 'storefront { status': () => overviewOf({ status, template: 'linen', live: null, history: [] }) }))
      expect(hasText(renderer, 'Setting up your storefront…')).toBe(true)

      const reads = asked(calls, 'storefront { status').length
      await act(async () => void jest.advanceTimersByTime(5_000))
      await settle()
      expect(asked(calls, 'storefront { status').length).toBe(reads + 1)

      status = 'not_published'
      await act(async () => void jest.advanceTimersByTime(5_000))
      await settle()
      expect(hasText(renderer, 'Setting up your storefront…')).toBe(false)
      expect(hasButton(renderer, 'Open studio')).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('asks whether to keep the merchant’s words when a site exists, and sends the answer', async () => {
    const { renderer, calls } = await show(base({ 'mutation Pick(': () => ({ chooseTemplate: 'unpublished_changes' }) }))
    await click(renderer, 'Change template')
    expect(hasText(renderer, 'Change template')).toBe(true)

    await press(pressablesNamed(renderer, 'Use this template')[2] as ReactTestInstance)
    await settle()
    expect(hasText(renderer, 'Use Noir?')).toBe(true)
    expect(asked(calls, 'mutation Pick(')).toHaveLength(0)
    await clickLast(renderer, 'Use template text')

    expect(asked(calls, 'mutation Pick(')[0]?.variables).toEqual({ key: 'noir', keep: false })
    expect(hasText(renderer, 'Switched to Noir')).toBe(true)
    expect(hasButton(renderer, 'Open studio')).toBe(true)
  })

  it('keeps the words when asked to, and starts from scratch under its own name', async () => {
    const { renderer, calls } = await show(base({ 'mutation Pick(': () => ({ chooseTemplate: 'unpublished_changes' }) }))
    await click(renderer, 'Change template')

    await press(pressablesNamed(renderer, 'Use this template')[0] as ReactTestInstance)
    await settle()
    expect(hasText(renderer, 'Start from scratch?')).toBe(true)
    await clickLast(renderer, 'Keep my words')

    expect(asked(calls, 'mutation Pick(')[0]?.variables).toEqual({ key: 'baseline', keep: true })
    expect(hasText(renderer, 'Started from scratch')).toBe(true)
  })

  it('asks nothing and changes nothing when the question is cancelled', async () => {
    const { renderer, calls } = await show(base())
    await click(renderer, 'Change template')
    await press(pressablesNamed(renderer, 'Use this template')[2] as ReactTestInstance)
    await settle()

    await clickLast(renderer, 'Cancel')

    expect(asked(calls, 'mutation Pick(')).toHaveLength(0)
    expect(hasText(renderer, 'Use Noir?')).toBe(false)
  })

  it('goes back to the Storefront from Change template', async () => {
    const { renderer } = await show(base())
    await click(renderer, 'Change template')

    await click(renderer, '← Back to Storefront')

    expect(hasButton(renderer, 'Open studio')).toBe(true)
  })

  it.each([
    ['BRAND_NOT_READY', 'Add your shop name and logo first.'],
    ['INVALID_TEMPLATE', 'That template isn’t offered any more.'],
    ['IN_PROGRESS', 'Your storefront is still being set up. Try again in a minute.'],
    ['STUDIO_UNAVAILABLE', 'The studio couldn’t start. Try again in a minute.'],
    ['CHANGE_REFUSED', 'That template didn’t pass our checks — nothing on your site changed.'],
    ['FORBIDDEN', 'Only the store owner can change the storefront.'],
  ])('words the refusal %s and stays on the gallery', async (code, words) => {
    const { renderer } = await show(
      base({
        'storefront { status': () => noSite,
        'mutation Pick(': () => {
          throw new ApiError(code, 'x')
        },
      }),
    )

    await press(pressablesNamed(renderer, 'Use this template')[1] as ReactTestInstance)
    await settle()

    expect(hasText(renderer, words)).toBe(true)
    expect(hasText(renderer, 'Choose a starting point')).toBe(true)
  })

  it('says how many are ahead when the studio is queued', async () => {
    const { renderer } = await show(
      base({
        'storefront { status': () => noSite,
        'mutation Pick(': () => {
          throw new ApiError('STUDIO_QUEUED', 'x', { place: 3 })
        },
      }),
    )

    await press(pressablesNamed(renderer, 'Use this template')[1] as ReactTestInstance)
    await settle()

    expect(hasText(renderer, 'The studio is busy — you’re number 3 in line. Try again in a moment.')).toBe(true)
  })

  it('says a site that could not be made, and offers the gallery again', async () => {
    const { renderer } = await show(base({ 'storefront { status': () => overviewOf({ status: 'create_failed', template: null, live: null, history: [] }) }))

    expect(hasText(renderer, 'We couldn’t set up your storefront. Pick a template to try again.')).toBe(true)
    expect(hasButton(renderer, 'Use this template')).toBe(true)
  })

  it('says there are no templates when the API lists none', async () => {
    const { renderer } = await show(base({ 'storefront { status': () => noSite, storefrontTemplates: () => ({ storefrontTemplates: [] }) }))

    expect(hasText(renderer, 'No templates yet')).toBe(true)
  })
})

describe('the Design tab', () => {
  it('sits first of the designer’s tabs: Design, Blog and Site settings, with no Pages', async () => {
    const { renderer } = await show(base())

    expect(byRole(renderer, 'tab').map((tab) => tab.findAll((node) => (node.type as unknown) === 'Text').map((node) => String(node.props.children)).join(''))).toEqual(['Design', 'Blog', 'Site settings'])
    expect(byRole(renderer, 'tab').map((tab) => tab.props.accessibilityState.selected)).toEqual([true, false, false])
  })

  it('says what is live, and opens the studio, the live site and the gallery', async () => {
    const { renderer } = await show(base())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Storefront', 'juniper.my-store.one · version 3 is live · Linen template']))
    await click(renderer, 'Open studio')
    expect(mockPush).toHaveBeenCalledWith('/more/storefront/studio')
    await click(renderer, 'View live site ↗')
    expect(openURL).toHaveBeenCalledWith('https://juniper.my-store.one')
  })

  it('says unpublished changes wait, continues in the studio, and asks before it discards', async () => {
    let draft = true
    const { renderer, calls } = await show(
      base({
        'storefront { status': () => overviewOf({ status: draft ? 'unpublished_changes' : 'same_as_live', draft: draft ? { previewReady: true } : null }),
        'mutation { discardDraft }': () => {
          draft = false
          return { discardDraft: true }
        },
      }),
    )

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Unpublished changes.']))
    expect(hasButton(renderer, 'Continue in studio')).toBe(true)
    await click(renderer, 'Discard')
    expect(hasText(renderer, 'Discard this draft?')).toBe(true)
    expect(asked(calls, 'discardDraft')).toHaveLength(0)
    await clickLast(renderer, 'Discard draft')

    expect(asked(calls, 'discardDraft')).toHaveLength(1)
    expect(hasText(renderer, 'Unpublished changes.')).toBe(false)
    expect(hasButton(renderer, 'Open studio')).toBe(true)
  })

  it('says nothing is published before the first publish', async () => {
    const { renderer } = await show(base({ 'storefront { status': () => overviewOf({ status: 'not_published', live: null, history: [] }) }))

    expect(hasText(renderer, 'Not published yet')).toBe(true)
    expect(hasButton(renderer, 'View live site ↗')).toBe(false)
  })

  it('names the template by its key when the API has no name for it, and “Custom” for none', async () => {
    const unnamed = await show(base({ storefrontTemplates: () => ({ storefrontTemplates: [] }), 'storefront { status': () => overviewOf({ template: 'oak' }) }))
    expect(hasText(unnamed.renderer, 'version 3 is live · oak template')).toBe(true)

    const custom = await show(base({ 'storefront { status': () => overviewOf({ template: null }) }))
    expect(hasText(custom.renderer, 'version 3 is live · Custom template')).toBe(true)
  })
})

describe('a Manager, who can look and changes nothing', () => {
  const asManager = (over: Handlers = {}) => show(base({ 'acting { permissions': () => access(manager), 'storefront { status': () => overviewOf({ status: 'unpublished_changes', draft: { previewReady: true } }), ...over }), 'manager')

  it('sees the Design tab with the notice, and no way to change the template, open the studio or discard', async () => {
    const { renderer } = await asManager()

    expect(hasText(renderer, 'You can look, but only the store owner can change the storefront.')).toBe(true)
    expect(hasText(renderer, 'Unpublished changes.')).toBe(true)
    for (const label of ['Change template', 'Open studio', 'Continue in studio', 'Discard']) expect(hasButton(renderer, label)).toBe(false)
  })

  it('sees Site settings read-only, with no Save and fields that cannot be typed in', async () => {
    const { renderer } = await asManager()

    await click(renderer, 'Site settings')

    expect(hasText(renderer, 'Brand')).toBe(true)
    expect(hasButton(renderer, 'Save')).toBe(false)
    expect(field(renderer, 'Shop name').props.editable).toBe(false)
    expect(field(renderer, 'Page title').props.editable).toBe(false)
    expect(hasButton(renderer, 'Choose from your photos')).toBe(false)
  })

  it('sees a store with no site as “No storefront yet”, never the gallery', async () => {
    const { renderer } = await asManager({ 'storefront { status': () => noSite })

    expect(hasText(renderer, 'No storefront yet. The store owner sets it up.')).toBe(true)
    expect(hasButton(renderer, 'Use this template')).toBe(false)
  })

  it('is told the same of an Owner’s store that is view-only for payment', async () => {
    const { renderer } = await show(base(), 'owner', readOnlyState)

    expect(hasText(renderer, 'Your store is view-only until the payment goes through. Your site stays live.')).toBe(true)
    for (const label of ['Change template', 'Open studio']) expect(hasButton(renderer, label)).toBe(false)
  })
})

describe('who gets the designer', () => {
  it('tells a seat without a storefront it has no access, before anything is read', async () => {
    const { renderer, calls } = await show(base({ 'acting { permissions': () => access([]) }), 'staff')

    expect(asked(calls, 'storefront { status')).toHaveLength(0)
    expect(hasButton(renderer, 'Design')).toBe(false)
  })

  it('shows a failed read as a designed state with a way to try again', async () => {
    const { renderer } = await show(
      base({
        'storefront { status': () => {
          throw new ApiError('NO_RESPONSE', 'x')
        },
      }),
    )

    expect(hasButton(renderer, 'Try again')).toBe(true)
  })
})

describe('Site settings', () => {
  const settings = async (over: Handlers = {}) => {
    const shown = await show(base(over))
    await click(shown.renderer, 'Site settings')
    return shown
  }

  it('saves a changed brand as a whole and says it shows after the next publish', async () => {
    const { renderer, calls } = await settings({ 'mutation Brand(': () => ({ saveStorefrontBrand: brandOf({ shopName: 'Juniper House' }).storefrontBrand }) })

    expect(hasButton(renderer, 'Save')).toBe(false)
    await type(renderer, 'Shop name', 'Juniper House')
    await click(renderer, 'Save')

    const input = (asked(calls, 'mutation Brand(')[0]?.variables as { input: Record<string, unknown> }).input
    expect(input).toMatchObject({ shopName: 'Juniper House', logoAssetId: 'logo-1', tagline: 'Handloom from Jaipur', contactEmail: 'hello@juniper.test' })
    expect(hasText(renderer, 'Brand saved. Your live site shows it after your next publish.')).toBe(true)
    expect(hasButton(renderer, 'Save')).toBe(false)
  })

  it('puts a changed brand back as saved with Cancel, and sends nothing', async () => {
    const { renderer, calls } = await settings()

    await type(renderer, 'Shop name', 'Another')
    await click(renderer, 'Cancel')

    expect(field(renderer, 'Shop name').props.value).toBe('Juniper & Co.')
    expect(asked(calls, 'mutation Brand(')).toHaveLength(0)
  })

  it('will not save a brand with no name, and says so at the name', async () => {
    const { renderer, calls } = await settings()

    await type(renderer, 'Shop name', '   ')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation Brand(')).toHaveLength(0)
    expect(hasText(renderer, 'Add your shop name and logo to continue.')).toBe(true)
  })

  it('can take the favicon off and put a new logo in', async () => {
    const { renderer, calls } = await settings({ storefrontBrand: () => brandOf({ faviconAssetId: 'fav-1' }), 'mutation Brand(': () => ({ saveStorefrontBrand: brandOf().storefrontBrand }) })

    await click(renderer, 'Remove')
    await click(renderer, 'Replace')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation Brand(')[0]?.variables).toMatchObject({ input: { faviconAssetId: null, logoAssetId: 'logo-new' } })
  })

  it('shows what is in Search and sharing, with how much of each limit is used, and saves it', async () => {
    const { renderer, calls } = await settings({ 'mutation Seo(': () => ({ saveStorefrontSeo: { title: 'New title', description: 'Hand-woven cottons.', shareImageAssetId: 'photo-1' } }) })

    expect(hasText(renderer, '24 / 60')).toBe(true)
    await type(renderer, 'Page title', 'New title')
    await click(renderer, 'Use photo 1')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation Seo(')[0]?.variables).toEqual({ input: { title: 'New title', description: 'Hand-woven cottons.', shareImageAssetId: 'photo-1' } })
    expect(hasText(renderer, 'Saved — search engines pick it up within a few days. No publish needed.')).toBe(true)
  })

  it('turns red and refuses to save past the limits, in words, and sends nothing', async () => {
    const { renderer, calls } = await settings()

    await type(renderer, 'Page title', 'x'.repeat(61))

    expect(hasText(renderer, '61 / 60 · too long')).toBe(true)
    expect(hasText(renderer, 'Shorten the title or the description to save.')).toBe(true)
    expect(disabled(renderer, 'Save')).toBe(true)
    expect(asked(calls, 'mutation Seo(')).toHaveLength(0)
  })

  it('says there are no photos to pick a share image from', async () => {
    const { renderer } = await settings({ 'query Recent(': () => ({ products: { nodes: [] } }) })

    expect(hasText(renderer, 'Add product photos to pick a share image.')).toBe(true)
  })

  it('says a refusal of Search and sharing by its code', async () => {
    const { renderer } = await settings({
      'mutation Seo(': () => {
        throw new ApiError('INVALID_IMAGE', 'x')
      },
    })

    await type(renderer, 'Page title', 'Another')
    await click(renderer, 'Save')

    expect(hasText(renderer, 'Pick one of your product photos.')).toBe(true)
  })
})
