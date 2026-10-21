import { frameAddress, frameMayLoad, frameOriginOf, nextVersionOf, noteText, overlayText, pageOptions, sampleAddress, sandboxOf, studioPathPattern } from './studioRules'

const frame = 'https://juniper.webpreview.store/__studio/AbC123_-xyz/'

describe('where the studio’s frame may load from (AI-STUDIO §1, §8)', () => {
  it('takes only an https address under /__studio/{session}/ on the store’s preview origin', () => {
    expect(frameOriginOf(frame, 'shop.test')).toBe('https://juniper.webpreview.store')
    expect(frameOriginOf('https://Juniper.WebPreview.store/__studio/abc/', 'shop.test')).toBe('https://juniper.webpreview.store')
  })

  it.each([
    ['http, not https', 'http://juniper.webpreview.store/__studio/abc/'],
    ['the portal host', 'https://shop.test/__studio/abc/'],
    ['the portal host in capitals', 'https://SHOP.TEST/__studio/abc/'],
    ['no studio path', 'https://juniper.webpreview.store/'],
    ['another path', 'https://juniper.webpreview.store/preview/abc/'],
    ['no trailing slash', 'https://juniper.webpreview.store/__studio/abc'],
    ['a query', 'https://juniper.webpreview.store/__studio/abc/?x=1'],
    ['a fragment', 'https://juniper.webpreview.store/__studio/abc/#x'],
    ['a user name in the address', 'https://shop.test@juniper.webpreview.store/__studio/abc/'],
    ['a host that is not dotted', 'https://localhost/__studio/abc/'],
    ['something that is no address', 'not an address'],
  ])('refuses %s', (_name, address) => {
    expect(frameOriginOf(address, 'shop.test')).toBeNull()
  })

  it('moves the frame to a page only under its own session, and to the home page for anything odd', () => {
    expect(frameAddress(frame, '/')).toBe(frame)
    expect(frameAddress(frame, '/collections/all/')).toBe(`${frame}collections/all/`)
    expect(frameAddress(frame, '/about')).toBe(`${frame}about`)
    expect(frameAddress(frame, '/../../elsewhere')).toBe(frame)
    expect(frameAddress(frame, '//evil.example/')).toBe(frame)
    expect(frameAddress(frame, 'https://evil.example/')).toBe(frame)
    expect(frameAddress(frame, '/a b')).toBe(frame)
  })

  it.each(['/%2e%2e/%2e%2e/other/', '/%2E%2E/', '/./', '/a/./b', '/a/../b', '/a%2fb', '/a%5cb', '/%2e/', '/a%00b'])('sends the encoded or dotted path %s to the home page, whatever decodes it later', (path) => {
    expect(frameAddress(frame, path)).toBe(frame)
  })

  it('lets the frame go only to addresses under its own session, so a link out of it opens nowhere', () => {
    expect(frameMayLoad(frame, frame)).toBe(true)
    expect(frameMayLoad(`${frame}products/kurta/`, frame)).toBe(true)
    expect(frameMayLoad('https://evil.example/__studio/AbC123_-xyz/', frame)).toBe(false)
    expect(frameMayLoad('https://juniper.webpreview.store/', frame)).toBe(false)
    expect(frameMayLoad('https://juniper.webpreview.store/__studio/other/', frame)).toBe(false)
    expect(frameMayLoad('https://shop.test/', frame)).toBe(false)
    expect(frameMayLoad('about:blank', frame)).toBe(false)
  })

  it.each([`${frame}%2e%2e/%2e%2e/other/`, `${frame}%2E%2E/`, `${frame}../other/`, `${frame}./`, `${frame}a/../b`, `${frame}a/.%2e/b`, `${frame}a%2f..%2fb`, `${frame}a%5cb`, `${frame}a\\b`,`${frame}a/%2e%2e`])('refuses %s, which a server could resolve out of the session', (address) => {
    expect(frameMayLoad(address, frame)).toBe(false)
  })

  it('allows a name with dots in it and a query that mentions dots', () => {
    expect(frameMayLoad(`${frame}assets/app.v2.js`, frame)).toBe(true)
    expect(frameMayLoad(`${frame}collections/all/?next=/../x`, frame)).toBe(true)
    expect(frameMayLoad(`${frame}products/a%20b/`, frame)).toBe(true)
  })

  it('does not take a long path made to stall the pattern', () => {
    const started = Date.now()
    expect(frameAddress(frame, `/${'a'.repeat(5000)}!`)).toBe(frame)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('what the studio says about the sandbox', () => {
  it('words each state of the session the API answered', () => {
    expect(overlayText(sandboxOf('starting', null))).toBe('Opening your studio…')
    expect(overlayText(sandboxOf('queued', 2))).toBe('You’re next — about 40 seconds')
    expect(overlayText(sandboxOf('busy', null))).toBe('Finishing your previous change…')
    expect(overlayText(sandboxOf('unavailable', null))).toBe('The studio couldn’t start. Try again in a minute.')
    expect(overlayText({ kind: 'ended' })).toBe('Your studio session ended. Reopen the studio to keep designing.')
    expect(overlayText(sandboxOf('ready', null))).toBeNull()
  })
})

describe('the page picker', () => {
  it('lists core’s routes, the policies, the content pages and the AI’s own pages, each under its group', () => {
    const options = pageOptions({ product: { name: 'Indigo kurta', slug: 'indigo-kurta' }, content: [{ title: 'Questions', path: '/faq' }], custom: ['/lookbook'] })

    expect(options.map((option) => option.value)).toEqual(['/', '/collections/all/', '/products/indigo-kurta/', '/search/', '/cart/', '/checkout/', '/account/', '/sign-in/', '/policies/terms/', '/policies/privacy/', '/policies/shipping/', '/policies/returns/', '/faq', '/lookbook'])
    expect(options.find((option) => option.value === '/products/indigo-kurta/')?.label).toBe('Product: Indigo kurta')
    expect(options.find((option) => option.value === '/faq')?.group).toBe('Content pages')
    expect(options.find((option) => option.value === '/lookbook')?.group).toBe('Pages the AI made')
  })

  it('leaves out the product page when no product has an address', () => {
    expect(pageOptions({ product: null, content: [], custom: [] }).some((option) => option.value.startsWith('/products/'))).toBe(false)
  })

  it('opens on a path only when it is one', () => {
    expect(studioPathPattern.test('/faq')).toBe(true)
    expect(studioPathPattern.test('faq')).toBe(false)
    expect(studioPathPattern.test('/a b')).toBe(false)
    expect(studioPathPattern.test('/a\\b')).toBe(false)
  })
})

describe('a website to take inspiration from', () => {
  it('is a full https address with a dotted host', () => {
    expect(sampleAddress(' https://example.com/shop ')).toBe('https://example.com/shop')
    expect(sampleAddress('http://example.com')).toBeNull()
    expect(sampleAddress('https://localhost')).toBeNull()
    expect(sampleAddress('example.com')).toBeNull()
    expect(sampleAddress('https://exa mple.com')).toBeNull()
  })
})

describe('the conversation’s notes', () => {
  it('words a template, scratch, undo and discard, and drops a code it does not know', () => {
    const name = (key: string) => (key === 'linen' ? 'Linen' : key)
    expect(noteText('template:linen', name)).toBe('Switched to Linen')
    expect(noteText('template:baseline', name)).toBe('Started from scratch')
    expect(noteText('undone', name)).toBe('Change undone')
    expect(noteText('discarded', name)).toBe('Changes discarded')
    expect(noteText('something-new', name)).toBeNull()
  })
})

describe('the next version', () => {
  it('is one past the live version and every version taken', () => {
    expect(nextVersionOf({ status: 'same_as_live', template: 'linen', live: { number: 3 }, draft: null, history: [{ number: 3 }, { number: 2 }] })).toBe(4)
    expect(nextVersionOf({ status: 'not_published', template: 'linen', live: null, draft: { previewReady: true }, history: [] })).toBe(1)
    expect(nextVersionOf({ status: 'same_as_live', template: 'linen', live: { number: 2 }, draft: null, history: [{ number: 5 }] })).toBe(6)
  })
})
