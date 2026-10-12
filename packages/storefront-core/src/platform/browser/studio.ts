import { z } from 'zod'
import { studioPagePath } from '../render/studio'
import { watchAddress } from './router'

// The frame's side of the studio's messages (storefront AI-STUDIO §8): posted only to the portal's origin, heard only
// from the portal's own window at that origin.

const editMessage = z.strictObject({ type: z.literal('df-studio:edit'), on: z.boolean() })

const hover = { outline: '2px dashed #2e7bd1', 'outline-offset': '2px' } as const

export type StudioFrameOptions = {
  /** The frame's `/__studio/{session}/`; null outside the studio, where nothing is connected. */
  base: string | null
  /** The portal's origin from the frame's page (`studioPortalOrigin`); null when the page carries none. */
  portalOrigin: string | null
  /** The content key of words the frame shows (`TextKeys.keyOf`), for the bundle on screen now. */
  keyOf: (text: string) => string | null
  /** The window that framed this one; `window.parent` outside tests. */
  parent?: Pick<Window, 'postMessage'>
}

const ownText = (element: Element): string =>
  [...element.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join('')

/**
 * Reports each page the frame shows, the first included, and with Edit text on turns a click on words into their
 * key instead of following it. Returns the function that disconnects it.
 */
export const connectStudioFrame = ({ base, portalOrigin, keyOf, parent = window.parent }: StudioFrameOptions): (() => void) => {
  if (!base || !portalOrigin || parent === window) return () => undefined
  const post = (message: { type: string } & Record<string, string>) => parent.postMessage(message, portalOrigin)
  const page = () => post({ type: 'df-studio:page', path: studioPagePath(base, location.pathname) })

  let editing = false
  let outlined: { element: HTMLElement; was: [string, string, string][] } | null = null

  // The clicked element's own words, or its nearest ancestor's when it has none (an icon inside a link).
  const wordsAt = (target: EventTarget | null): { element: HTMLElement; key: string } | null => {
    for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
      const text = ownText(element)
      const key = text.trim() ? keyOf(text) : null
      if (key && element instanceof HTMLElement) return { element, key }
    }
    return null
  }

  const unoutline = () => {
    if (!outlined) return
    for (const [name, value, priority] of outlined.was) {
      if (value) outlined.element.style.setProperty(name, value, priority)
      else outlined.element.style.removeProperty(name)
    }
    outlined = null
  }

  const outline = (element: HTMLElement) => {
    if (outlined?.element === element) return
    unoutline()
    outlined = { element, was: Object.keys(hover).map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]) }
    for (const [name, value] of Object.entries(hover)) element.style.setProperty(name, value, 'important')
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent || event.origin !== portalOrigin) return
    const parsed = editMessage.safeParse(event.data)
    if (!parsed.success) return
    editing = parsed.data.on
    if (!editing) unoutline()
  }

  const onOver = (event: MouseEvent) => {
    if (!editing) return
    const found = wordsAt(event.target)
    if (found) outline(found.element)
    else unoutline()
  }

  const onOut = (event: MouseEvent) => {
    if (editing && event.relatedTarget === null) unoutline()
  }

  const onClick = (event: MouseEvent) => {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    const found = wordsAt(event.target)
    if (found) post({ type: 'df-studio:text', key: found.key })
  }

  addEventListener('message', onMessage)
  addEventListener('mouseover', onOver, true)
  addEventListener('mouseout', onOut, true)
  addEventListener('click', onClick, true)
  const unwatch = watchAddress(page)
  page()
  return () => {
    unoutline()
    unwatch()
    removeEventListener('message', onMessage)
    removeEventListener('mouseover', onOver, true)
    removeEventListener('mouseout', onOut, true)
    removeEventListener('click', onClick, true)
  }
}
