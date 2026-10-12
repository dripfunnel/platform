// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTextKeys } from '../i18n/i18n'
import { studioFramePage, studioPortalOrigin } from '../render/studio'
import { navigate, setRouterBase } from './router'
import { connectStudioFrame } from './studio'

const base = '/__studio/Ab3_9-xYz0Ab3_9-xYz0Ab/'
const portal = 'https://store.partner-a.example'

let disconnect: () => void = () => undefined
const parent = { postMessage: vi.fn() }
const shown = createTextKeys()
shown.add('Linen, made slowly', 'home.hero.title')
shown.add('Shop the collection', 'home.hero.shop')
shown.add('Made slowly', 'pages.about.lead')
shown.add('Made slowly', 'common.footer.note')

const connect = (options: Partial<Parameters<typeof connectStudioFrame>[0]> = {}) => {
  disconnect = connectStudioFrame({ base, portalOrigin: portal, keyOf: (text) => shown.keyOf(text), parent, ...options })
}
const posted = () => parent.postMessage.mock.calls
const from = (data: unknown, origin = portal, source: unknown = parent) => dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }))
const click = (element: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}
const hover = (element: Element) => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

beforeEach(() => {
  history.replaceState(null, '', `${base}our-story`)
  setRouterBase(base)
  document.body.innerHTML = `
    <h1 id="title">Linen, made slowly</h1>
    <a id="shop" href="${base}collections/all/"><svg id="icon"></svg>Shop the collection</a>
    <p id="tie">Made slowly</p>
    <p id="plain">Words no one wrote</p>`
})

afterEach(() => {
  disconnect()
  setRouterBase(null)
  parent.postMessage.mockClear()
})

const byId = (id: string) => document.getElementById(id) as HTMLElement

describe('the studio frame’s messages (AI-STUDIO §8)', () => {
  it('reports the first page and each navigation, to the portal’s origin only', () => {
    connect()
    expect(posted()).toEqual([[{ type: 'df-studio:page', path: '/our-story' }, portal]])
    navigate('/our-story?tab=team')
    dispatchEvent(new PopStateEvent('popstate'))
    expect(posted()).toHaveLength(3)
    expect(posted().every(([message, origin]) => (message as { type: string }).type === 'df-studio:page' && origin === portal)).toBe(true)
  })

  it('with Edit text on, turns a click on words into their key and doesn’t follow it', () => {
    connect()
    const followed = vi.fn()
    byId('shop').addEventListener('click', followed)
    from({ type: 'df-studio:edit', on: true })
    parent.postMessage.mockClear()
    expect(click(byId('title')).defaultPrevented).toBe(true)
    const onLink = click(byId('icon'))
    expect(onLink.defaultPrevented).toBe(true)
    expect(followed).not.toHaveBeenCalled()
    expect(click(byId('plain')).defaultPrevented).toBe(true)
    expect(posted()).toEqual([
      [{ type: 'df-studio:text', key: 'home:hero.title' }, portal],
      [{ type: 'df-studio:text', key: 'home:hero.shop' }, portal],
    ])
  })

  it('resolves identical words to the first key shown', () => {
    connect()
    from({ type: 'df-studio:edit', on: true })
    click(byId('tie'))
    expect(posted().at(-1)).toEqual([{ type: 'df-studio:text', key: 'pages:about.lead' }, portal])
  })

  it('outlines hovered words while on, and puts the element’s own style back when turned off', () => {
    connect()
    byId('title').style.setProperty('outline', '1px solid red')
    const own = byId('title').style.getPropertyValue('outline')
    hover(byId('title'))
    expect(byId('title').style.getPropertyPriority('outline')).toBe('')
    from({ type: 'df-studio:edit', on: true })
    hover(byId('title'))
    expect(byId('title').style.getPropertyPriority('outline')).toBe('important')
    hover(byId('tie'))
    expect(byId('title').style.getPropertyValue('outline')).toBe(own)
    expect(byId('title').style.getPropertyPriority('outline')).toBe('')
    expect(byId('tie').style.getPropertyPriority('outline')).toBe('important')
    from({ type: 'df-studio:edit', on: false })
    expect(byId('tie').style.getPropertyValue('outline')).toBe('')
    parent.postMessage.mockClear()
    const event = click(byId('title'))
    expect(event.defaultPrevented).toBe(false)
    expect(posted()).toEqual([])
  })

  it('ignores Edit text from another origin, another window, or not in the protocol', () => {
    connect()
    from({ type: 'df-studio:edit', on: true }, 'https://evil.example')
    from({ type: 'df-studio:edit', on: true }, portal, window)
    from({ type: 'df-studio:edit', on: 'yes' })
    from({ type: 'df-studio:edit', on: true, extra: 1 })
    parent.postMessage.mockClear()
    expect(click(byId('title')).defaultPrevented).toBe(false)
    expect(posted()).toEqual([])
  })

  it.each([
    ['live or preview, with no studio base', { base: null }],
    ['a page that names no portal', { portalOrigin: null }],
    ['a page nobody framed', { parent: window }],
  ] as [string, Partial<Parameters<typeof connectStudioFrame>[0]>][])('does nothing on %s', (_name, options) => {
    const spy = vi.spyOn(window, 'postMessage')
    connect(options)
    navigate('/our-story?tab=team')
    from({ type: 'df-studio:edit', on: true }, portal, options.parent ?? parent)
    expect(click(byId('title')).defaultPrevented).toBe(false)
    expect(posted()).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('the portal the frame’s page names', () => {
  const page = '<!doctype html>\n<html><head><meta charset="utf-8"></head><body></body></html>'
  const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

  it('is written into the page’s head and read back, and a page without one names none', () => {
    const framed = studioFramePage(page, portal)
    expect(framed).toContain(`<head><meta name="df-studio-portal" content="${portal}">`)
    expect(studioPortalOrigin(parse(framed))).toBe(portal)
    expect(studioPortalOrigin(parse(page))).toBeNull()
  })

  it('is only ever an origin', () => {
    expect(() => studioFramePage(page, 'https://store.partner-a.example/path')).toThrow()
    expect(() => studioFramePage(page, 'https://a.example" onload="x')).toThrow()
    expect(studioPortalOrigin(parse('<head><meta name="df-studio-portal" content="javascript:alert(1)"></head>'))).toBeNull()
  })
})
