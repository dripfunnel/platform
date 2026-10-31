import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../../testing/harness'
import { resetScenario } from '../../states/scenario'
import { ContentEditorScreen } from './ContentEditorScreen'
import { ContentTab } from './ContentTab'

jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }
const mockPush = jest.fn()
const mockBack = jest.fn()
const mockPrevent = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: mockBack, navigate: jest.fn() }),
  useNavigation: () => ({ dispatch: jest.fn() }),
  useFocusEffect: jest.fn(),
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPrevent(...args) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../../graphql/partnerDomain', () => ({ partnerDomain: () => 'shop.test' }))
jest.mock('../../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))
jest.mock('../../products/story/ProductPicker', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react')
  return { ProductPicker: (props: Record<string, unknown>) => createElement('PickerStub', props) }
})

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const owner = ['storefront.read', 'publish']
const manager = ['storefront.read']
const access = (permissions: string[]) => ({ me: { acting: { permissions, seller: null } } })

const row = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Post ${id}`, path: `/blog/post-${id}`, status: 'published', publishAt: null, waitingForPublish: false, ...over })
const entryOf = (over: Record<string, unknown> = {}) => ({
  ...row('e1', { title: 'Our story', path: '/blog/our-story', status: 'draft' }),
  slug: 'our-story',
  body: [
    { kind: 'heading', text: 'Who we are', assetId: null, alt: null, items: null, productIds: null },
    { kind: 'text', text: 'We make cloth.', assetId: null, alt: null, items: null, productIds: null },
  ],
  seoTitle: null,
  seoDescription: null,
  author: null,
  tags: [],
  coverAssetId: null,
  revision: 4,
  ...over,
})
const list = (rows: unknown[], next: string | null = null) => ({ nodes: rows, pageInfo: { hasNextPage: next !== null, endCursor: next } })

const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const hasButton = (renderer: ReactTestRenderer, label: string) => pressablesNamed(renderer, label).length > 0
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
const field = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  return found
}
const hasField = (renderer: ReactTestRenderer, label: string) => renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function').length > 0
const type = async (renderer: ReactTestRenderer, label: string, value: string) => act(async () => field(renderer, label).props.onChangeText(value))
const picker = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'PickerStub')[0]

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the Journal list', () => {
  const baseList = (over: Handlers = {}): Handlers => ({
    'blogPosts(first': () => ({
      blogPosts: list([row('7', { title: 'Autumn arrivals', path: '/blog/autumn', status: 'scheduled', publishAt: '2026-11-02T00:00:00.000Z' }), row('8', { title: 'Care tips', path: '/blog/care', status: 'draft', waitingForPublish: true })]),
    }),
    ...over,
  })
  const showList = async (handlers: Handlers, canEdit = true) => {
    const { client, calls } = fakeApi(handlers)
    mockSession.client = client
    const renderer = await renderShell(<ContentTab client={client} canEdit={canEdit} />, { acting: actingAs('owner') })
    await settle()
    return { renderer, calls }
  }

  it('lists the posts with where they stand or waiting for the next publish, and reads no pages', async () => {
    const { renderer, calls } = await showList(baseList())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Autumn arrivals', 'Care tips', 'Draft · /blog/care', 'Your last save goes live with your shop’s next publish.']))
    expect(calls.filter((call) => call.query.includes('contentPages') || call.query.includes('customPagePaths'))).toHaveLength(0)
  })

  it('opens a post on its own screen, and starts a new one', async () => {
    const { renderer } = await showList(baseList())

    await click(renderer, 'Autumn arrivals')
    expect(mockPush).toHaveBeenCalledWith('/more/storefront/post/7')
    await click(renderer, 'Write a post')
    expect(mockPush).toHaveBeenCalledWith('/more/storefront/post/new')
  })

  it('says when a post goes live, in UTC', async () => {
    const { renderer } = await showList(baseList())

    expect(hasText(renderer, 'Goes live Nov 2, 2026 · /blog/autumn')).toBe(true)
  })

  it('shows no add button to a Manager', async () => {
    const { renderer } = await showList(baseList(), false)

    expect(hasText(renderer, 'Autumn arrivals')).toBe(true)
    expect(hasButton(renderer, 'Write a post')).toBe(false)
  })

  it('says so when there is nothing yet', async () => {
    const { renderer } = await showList(baseList({ 'blogPosts(first': () => ({ blogPosts: list([]) }) }))

    expect(hasText(renderer, 'No posts yet.')).toBe(true)
  })

  it('shows more from the cursor, and says when it could not', async () => {
    let fail = true
    const { renderer, calls } = await showList(
      baseList({
        'blogPosts(first': (variables) => {
          if (variables['after'] === null) return { blogPosts: list([row('1')], 'cursor-1') }
          if (fail) throw new ApiError('NO_RESPONSE', 'x')
          return { blogPosts: list([row('3', { title: 'Third' })]) }
        },
      }),
    )

    await click(renderer, 'Show more')
    expect(hasText(renderer, 'We couldn’t load more. Try again.')).toBe(true)
    fail = false
    await click(renderer, 'Show more')

    expect(asked(calls, 'blogPosts(first').map((call) => call.variables['after'])).toEqual([null, 'cursor-1', 'cursor-1'])
    expect(hasText(renderer, 'Third')).toBe(true)
    expect(hasButton(renderer, 'Show more')).toBe(false)
  })

  it('shows a failed read with a way to try again, and a plan without the Journal in words with no upgrade', async () => {
    const failed = await showList(
      baseList({
        'blogPosts(first': () => {
          throw new ApiError('NO_RESPONSE', 'x')
        },
      }),
    )
    expect(hasButton(failed.renderer, 'Try again')).toBe(true)

    const limited = await showList(
      baseList({
        'blogPosts(first': () => {
          throw new ApiError('PLAN_LIMIT', 'x')
        },
      }),
    )
    expect(hasText(limited.renderer, 'Your plan doesn’t include the Journal.')).toBe(true)
    expect(hasButton(limited.renderer, 'Try again')).toBe(false)
    expect(hasButton(limited.renderer, 'See plans')).toBe(false)
  })
})

describe('the Journal editor', () => {
  const base = (over: Handlers = {}): Handlers => ({
    'acting { permissions': () => access(owner),
    'query Entry(': () => ({ contentEntry: entryOf() }),
    'query Names(': () => ({ n0: { name: 'Indigo kurta' } }),
    ...over,
  })
  const showEditor = async (handlers: Handlers, id = 'e1', role = 'owner') => {
    const { client, calls } = fakeApi(handlers)
    mockSession.client = client
    const renderer = await renderShell(<ContentEditorScreen id={id} />, { acting: actingAs(role) })
    await settle()
    return { renderer, calls }
  }
  const saved = (over: Record<string, unknown> = {}) => ({ saveBlogPost: entryOf({ revision: 5, ...over }) })

  it('opens a new post with a paragraph and no footer switch or contact form, and makes its address from the title', async () => {
    const { renderer } = await showEditor(base(), 'new')

    expect(hasField(renderer, 'Text, block 1')).toBe(true)
    expect(hasField(renderer, 'Heading, block 1')).toBe(false)
    expect(hasButton(renderer, 'Add a contact form')).toBe(false)
    expect(renderer.root.findAll((node) => node.props.accessibilityRole === 'switch')).toHaveLength(0)
    await type(renderer, 'Title', 'Our  Story & more')
    expect(texts(renderer)).toContain('/blog/our-story-more')
  })

  it('saves a new post as a draft, keeping it off the shop, and names what the next save does', async () => {
    const { renderer, calls } = await showEditor(base({ 'mutation Save(': () => ({ saveBlogPost: entryOf({ status: 'draft', revision: 1 }) }) }), 'new')

    await type(renderer, 'Title', 'Our story')
    await type(renderer, 'Text, block 1', 'We make cloth.')
    await click(renderer, 'Save as draft')

    expect(asked(calls, 'mutation Save(')[0]?.query).toContain('saveBlogPost')
    expect(asked(calls, 'mutation Save(')[0]?.variables).toEqual({
      id: null,
      revision: null,
      input: { title: 'Our story', slug: 'our-story', body: [{ kind: 'text', text: 'We make cloth.' }], seoTitle: null, seoDescription: null, publish: false, author: null, tags: [], coverAssetId: null },
    })
    expect(hasText(renderer, 'Saved as a draft — not on your shop yet')).toBe(true)
    expect(hasText(renderer, 'Now: Draft')).toBe(true)
  })

  it('publishes at the revision it read, then says Update, and a second save changes the same post', async () => {
    const { renderer, calls } = await showEditor(base({ 'mutation Save(': () => saved({ status: 'published' }) }))

    await type(renderer, 'Title', 'Our story, retold')
    await click(renderer, 'Publish')
    expect(asked(calls, 'mutation Save(')[0]?.variables).toMatchObject({ id: 'e1', revision: 4, input: { title: 'Our story, retold', publish: true } })
    expect(hasText(renderer, 'Published. It goes live with your shop’s next publish.')).toBe(true)

    await type(renderer, 'Title', 'Again')
    await click(renderer, 'Update')
    expect(asked(calls, 'mutation Save(')[1]?.variables).toMatchObject({ id: 'e1', revision: 5 })
  })

  it('will not send a post with no title or a search listing past its limit, and says why', async () => {
    const { renderer, calls } = await showEditor(base(), 'new')

    await click(renderer, 'Publish')
    expect(hasText(renderer, 'Give it a title.')).toBe(true)

    await type(renderer, 'Title', 'Our story')
    await type(renderer, 'Title in search', 'x'.repeat(61))
    await click(renderer, 'Publish')
    expect(hasText(renderer, 'Shorten the title or description in search to save.')).toBe(true)
    expect(asked(calls, 'mutation Save(')).toHaveLength(0)
  })

  it('keeps a web address to what the API takes', async () => {
    const { renderer } = await showEditor(base(), 'new')

    await type(renderer, 'Web address', 'My Page!! 1--2')

    expect(field(renderer, 'Web address').props.value).toBe('mypage1-2')
  })

  it('adds, moves and removes blocks', async () => {
    const { renderer, calls } = await showEditor(base({ 'mutation Save(': () => saved() }))

    await click(renderer, 'Add a heading')
    await click(renderer, 'Add questions')
    await click(renderer, 'Move block 4 up')
    await click(renderer, 'Remove block 1')
    expect(hasField(renderer, 'Text, block 1')).toBe(true)
    expect(hasText(renderer, 'Questions and answers, block 2')).toBe(true)
    expect(pressableNamed(renderer, 'Move block 1 up').findAll((node) => typeof node.props.accessibilityState?.disabled === 'boolean')[0]?.props.accessibilityState.disabled).toBe(true)

    await click(renderer, 'Publish')
    expect((asked(calls, 'mutation Save(')[0]?.variables as { input: { body: unknown[] } }).input.body).toEqual([{ kind: 'text', text: 'We make cloth.' }, { kind: 'faq', items: [] }, { kind: 'heading', text: '' }])
  })

  it('edits questions and answers, and removes a question', async () => {
    const { renderer, calls } = await showEditor(base({ 'mutation Save(': () => saved() }), 'new')

    await click(renderer, 'Add questions')
    await click(renderer, '+ Add a question')
    await type(renderer, 'Question 1', 'Do you ship abroad?')
    await type(renderer, 'Answer 1', 'Yes.')
    await click(renderer, '+ Add a question')
    await click(renderer, 'Remove question 2')
    await type(renderer, 'Title', 'FAQ')
    await click(renderer, 'Publish')

    expect((asked(calls, 'mutation Save(')[0]?.variables as { input: { body: unknown[] } }).input.body).toContainEqual({ kind: 'faq', items: [{ question: 'Do you ship abroad?', answer: 'Yes.' }] })
  })

  it('shows the products a block names, says one that is gone, and takes ones picked by name', async () => {
    const withProducts = entryOf({ body: [{ kind: 'products', text: null, assetId: null, alt: null, items: null, productIds: ['p1', 'p2'] }] })
    const { renderer, calls } = await showEditor(
      base({
        'query Entry(': () => ({ contentEntry: withProducts }),
        'query Names(': () => ({ n0: { name: 'Indigo kurta' }, n1: null }),
        'mutation Save(': () => saved(),
      }),
    )

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Indigo kurta', 'A product no longer in your catalogue']))
    await click(renderer, 'Find a product to add')
    await act(async () => (picker(renderer)?.props.onPick as (picked: unknown[]) => void)([{ id: 'p9', name: 'Linen shirt' }]))
    expect(hasText(renderer, 'Linen shirt')).toBe(true)
    await click(renderer, 'Remove Indigo kurta')
    await click(renderer, 'Publish')

    expect((asked(calls, 'mutation Save(')[0]?.variables as { input: { body: unknown[] } }).input.body).toEqual([{ kind: 'products', productIds: ['p2', 'p9'] }])
  })

  it('says when the products’ names could not be read, and keeps them on the post', async () => {
    const withProducts = entryOf({ body: [{ kind: 'products', text: null, assetId: null, alt: null, items: null, productIds: ['p1'] }] })
    const { renderer, calls } = await showEditor(
      base({
        'query Entry(': () => ({ contentEntry: withProducts }),
        'query Names(': () => {
          throw new ApiError('NO_RESPONSE', 'x')
        },
        'mutation Save(': () => saved(),
      }),
    )

    expect(hasText(renderer, 'We couldn’t load these products’ names.')).toBe(true)
    expect(hasText(renderer, 'A product whose name didn’t load')).toBe(true)
    await click(renderer, 'Publish')
    expect((asked(calls, 'mutation Save(')[0]?.variables as { input: { body: unknown[] } }).input.body).toEqual([{ kind: 'products', productIds: ['p1'] }])
  })

  it('keeps a photo the post already has, says it is changed on the web, and offers no way to add one', async () => {
    const withPhoto = entryOf({ body: [{ kind: 'image', text: null, assetId: 'img-1', alt: 'Loom at dawn', items: null, productIds: null }] })
    const { renderer, calls } = await showEditor(base({ 'query Entry(': () => ({ contentEntry: withPhoto }), 'mutation Save(': () => saved() }))

    expect(hasText(renderer, 'A photo on this page stays as it is. Add or change photos on the web portal.')).toBe(true)
    expect(hasButton(renderer, 'Add a photo')).toBe(false)
    await click(renderer, 'Publish')

    expect((asked(calls, 'mutation Save(')[0]?.variables as { input: { body: unknown[] } }).input.body).toEqual([{ kind: 'image', assetId: 'img-1', alt: 'Loom at dawn' }])
  })

  it('sends back what a post has that the phone draws no control for, so a save clears none of it', async () => {
    const post = entryOf({ slug: 'autumn', path: '/blog/autumn', status: 'scheduled', publishAt: '2026-11-02T00:00:00.000Z', author: 'Meera', tags: ['care', 'cotton'], coverAssetId: 'cover-1' })
    const { renderer, calls } = await showEditor(base({ 'query Entry(': () => ({ contentEntry: post }), 'mutation Save(': () => ({ saveBlogPost: { ...post, revision: 5 } }) }))

    await type(renderer, 'Title', 'Autumn, again')
    await click(renderer, 'Save as draft')

    expect(asked(calls, 'mutation Save(')[0]?.query).toContain('saveBlogPost')
    expect(asked(calls, 'mutation Save(')[0]?.variables).toMatchObject({ id: 'e1', revision: 4, input: { publish: false, publishAt: '2026-11-02T00:00:00.000Z', author: 'Meera', tags: ['care', 'cotton'], coverAssetId: 'cover-1' } })
  })

  it.each([
    ['custom_page', '/lookbook', '/lookbook is a page your AI designer made. Choose another web address, or change that page in the studio.'],
    ['blog_post', '/blog/autumn', 'Another of your posts already uses /blog/autumn. Choose another web address.'],
  ])('says what holds the address when it is taken (%s)', async (heldBy, path, words) => {
    const { renderer } = await showEditor(
      base({
        'mutation Save(': () => {
          throw new ApiError('PATH_TAKEN', 'x', { path, heldBy })
        },
      }),
    )

    await click(renderer, 'Publish')

    expect(hasText(renderer, words)).toBe(true)
    expect(field(renderer, 'Title').props.value).toBe('Our story')
  })

  it.each([
    ['STALE_REVISION', {}, 'Someone else saved this since you opened it.'],
    ['INVALID_INPUT', {}, 'Something here isn’t valid. Check each block and try again.'],
    ['INVALID_INPUT', { field: 'slug' }, 'Give it a web address: letters, numbers and hyphens.'],
    ['NOT_FOUND', {}, 'This isn’t here any more. Go back to the list.'],
    ['PLAN_LIMIT', {}, 'Your plan doesn’t include this.'],
    ['READ_ONLY', {}, 'Your store is view-only until the payment goes through.'],
    ['FORBIDDEN', {}, 'Only the store owner can change the storefront.'],
    ['NO_RESPONSE', {}, 'That didn’t save. Check your connection and try again.'],
  ])('words the refusal %s and keeps what was typed', async (code, details, words) => {
    const { renderer } = await showEditor(
      base({
        'mutation Save(': () => {
          throw new ApiError(code, 'x', details)
        },
      }),
    )

    await type(renderer, 'Title', 'Changed')
    await click(renderer, 'Publish')

    expect(hasText(renderer, words)).toBe(true)
    expect(field(renderer, 'Title').props.value).toBe('Changed')
  })

  it('asks before it leaves with unsaved changes, and not otherwise', async () => {
    const { renderer } = await showEditor(base())
    expect(mockPrevent).toHaveBeenLastCalledWith(false, expect.anything())

    await type(renderer, 'Title', 'Changed')

    expect(mockPrevent).toHaveBeenLastCalledWith(true, expect.anything())
  })

  it('asks before it deletes, says what follows, deletes by the post’s own mutation and goes back when it is done', async () => {
    const { renderer, calls } = await showEditor(base({ 'mutation Delete(': () => ({ deleteBlogPost: true }) }))

    await click(renderer, 'Delete post')
    expect(hasText(renderer, 'Delete “Our story”?')).toBe(true)
    expect(hasText(renderer, 'It comes off your shop with the next publish.')).toBe(true)
    expect(asked(calls, 'mutation Delete(')).toHaveLength(0)
    await clickLast(renderer, 'Delete post')

    expect(asked(calls, 'mutation Delete(')[0]?.query).toContain('deleteBlogPost')
    expect(asked(calls, 'mutation Delete(')[0]?.variables).toEqual({ id: 'e1' })
    expect(hasText(renderer, 'Deleted')).toBe(true)
  })

  it('says a refused delete by its code, in the sheet', async () => {
    const { renderer } = await showEditor(
      base({
        'mutation Delete(': () => {
          throw new ApiError('NOT_FOUND', 'x')
        },
      }),
    )

    await click(renderer, 'Delete post')
    await clickLast(renderer, 'Delete post')

    expect(hasText(renderer, 'This isn’t here any more. Go back to the list.')).toBe(true)
    expect(hasText(renderer, 'Delete “Our story”?')).toBe(true)
  })

  it('offers no delete for a post that is not saved yet', async () => {
    const { renderer } = await showEditor(base(), 'new')

    expect(hasButton(renderer, 'Delete post')).toBe(false)
  })

  it('lets a Manager look at a post and change nothing', async () => {
    const { renderer } = await showEditor(base({ 'acting { permissions': () => access(manager) }), 'e1', 'manager')

    expect(hasText(renderer, 'You can look, but only the store owner can change the storefront.')).toBe(true)
    expect(field(renderer, 'Title').props.editable).toBe(false)
    expect(field(renderer, 'Heading, block 1').props.editable).toBe(false)
    for (const label of ['Publish', 'Update', 'Save as draft', 'Delete post', 'Add a heading', 'Add text', 'Remove block 1', 'Move block 2 up']) expect(hasButton(renderer, label)).toBe(false)
  })

  it('tells a seat without a storefront it has no access, before it reads the post', async () => {
    const { renderer, calls } = await showEditor(base({ 'acting { permissions': () => access([]) }), 'e1', 'staff')

    expect(asked(calls, 'query Entry(')).toHaveLength(0)
    expect(hasField(renderer, 'Title')).toBe(false)
  })

  it('says a post that is not there is not found, and a failed read can be tried again', async () => {
    const missing = await showEditor(base({ 'query Entry(': () => ({ contentEntry: null }) }))
    expect(hasField(missing.renderer, 'Title')).toBe(false)

    const failed = await showEditor(
      base({
        'query Entry(': () => {
          throw new ApiError('NO_RESPONSE', 'x')
        },
      }),
    )
    expect(hasButton(failed.renderer, 'Try again')).toBe(true)
  })
})
