'use client'

import { useEffect } from 'react'

// Core owns the <head> (ARCHITECTURE §8); in the browser it keeps the title, description, canonical, Open Graph and
// robots in step with what the page shows. The live build writes the same head into each page's HTML (LIVE-SHOP §4).

export type Head = {
  title?: string | null | undefined
  description?: string | null | undefined
  /** A path on this store; the query a filter or sort adds is left out of it (ARCHITECTURE §8 "Crawling"). */
  canonical?: string | null | undefined
  image?: string | null | undefined
  /** noindex: the preview and studio, and pages search engines shouldn't list. */
  hidden?: boolean | undefined
}

/** The store's head for a page: the home page's search and sharing on `/` (SAAS §9.2), the name and description elsewhere. */
export const storeHead = (store: { name: string; description?: string | null | undefined; seo?: { title: string | null; description: string | null; image: { url: string } | null } | null }, path: string): Head => {
  const home = path === '/' ? store.seo : null
  return { title: home?.title ?? store.name, description: home?.description ?? store.description ?? null, image: home?.image?.url ?? null }
}

/** The store's own head (0) under a page's (1), whatever order their effects run in. */
type Entry = { level: 0 | 1; head: Head }
const entries: Entry[] = []
const mark = 'data-df-head'

const setMeta = (doc: Document, key: 'name' | 'property', name: string, content: string | null) => {
  let meta = doc.head.querySelector<HTMLMetaElement>(`meta[${key}="${name}"]`)
  if (content === null) return meta?.remove()
  if (!meta) {
    meta = doc.createElement('meta')
    meta.setAttribute(key, name)
    meta.setAttribute(mark, '')
    doc.head.append(meta)
  }
  meta.setAttribute('content', content)
}

const setCanonical = (doc: Document, href: string | null) => {
  let link = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (href === null) return link?.remove()
  if (!link) {
    link = doc.createElement('link')
    link.setAttribute('rel', 'canonical')
    link.setAttribute(mark, '')
    doc.head.append(link)
  }
  link.setAttribute('href', href)
}

/** The page's entries over the store's, the most recent winning field by field; any entry's noindex holds. */
export const mergedHead = (list: readonly Entry[]): Head => {
  const ordered = [...list].sort((a, b) => a.level - b.level)
  const head = ordered.reduce<Head>((merged, e) => ({ ...merged, ...Object.fromEntries(Object.entries(e.head).filter(([, v]) => v !== undefined && v !== null)) }), {})
  return { ...head, hidden: list.some((e) => e.head.hidden === true) }
}

// The build's own link (publish/pages.ts) stands while the page is still the one it was written for.
const builtCanonical = (doc: Document, origin: string) => {
  const href = doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href')
  return href === `${origin}${doc.location.pathname}` ? href : null
}

export const applyHead = (doc: Document, head: Head, origin: string) => {
  if (head.title) doc.title = head.title
  setMeta(doc, 'name', 'description', head.description ?? null)
  setMeta(doc, 'property', 'og:title', head.title ?? null)
  setMeta(doc, 'property', 'og:description', head.description ?? null)
  setMeta(doc, 'property', 'og:image', head.image ?? null)
  // Only ever added: a live page the build marked noindex (a cart, an account page) stays so.
  if (head.hidden) setMeta(doc, 'name', 'robots', 'noindex, nofollow')
  setCanonical(doc, head.hidden ? null : head.canonical ? new URL(head.canonical, origin).toString() : builtCanonical(doc, origin))
}

const refresh = () => applyHead(document, mergedHead(entries), location.origin)

export const useHeadAt = (level: Entry['level'], head: Head) => {
  const { title, description, canonical, image, hidden } = head
  useEffect(() => {
    const entry: Entry = { level, head: { title, description, canonical, image, hidden } }
    entries.push(entry)
    refresh()
    return () => {
      entries.splice(entries.indexOf(entry), 1)
      refresh()
    }
  }, [level, title, description, canonical, image, hidden])
}

/** Adds to the page's head while the component is shown: a theme's own page title, and what core's hooks load. */
export const useHead = (head: Head) => useHeadAt(1, head)
