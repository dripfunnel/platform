import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import type { ThemeRoute } from '@dripfunnel/storefront-core'
import type { GuardContext } from '@dripfunnel/storefront-core/guard'
import { chromiumPath } from '../browser'
import { serverTheme } from '../publish/render'
import { storeOf } from './render'

// A picture of one page of a working copy for the studio's agent (storefront AI-STUDIO §4 "The agent"): rendered here
// without the shop's data, then drawn by the image's Chromium with every request but data: refused, so nothing leaves.

export type Device = 'desktop' | 'tablet' | 'phone'
export type Picture = { images: string[]; problem: string | null }

const slices = { desktop: { width: 1440, height: 1440 }, tablet: { width: 834, height: 1112 }, phone: { width: 390, height: 844 } } as const
export const maxPictureSlices = 3
const stepMs = 10_000

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)

/** `page`: a core route's name (home, product, …) or a custom page's path (/about); JPEG slices from the top, base64. */
export const pagePicture = async (repo: string, work: string, page: string, device: Device, context: GuardContext): Promise<Picture> => {
  const executablePath = chromiumPath()
  if (!executablePath) return { images: [], problem: 'No browser here to draw the page.' }
  let html: string
  let css: string
  try {
    const server = await serverTheme(repo, work, '/')
    const Page = page.startsWith('/') ? server.page(null, page) : server.page(page as ThemeRoute, null)
    if (!Page) return { images: [], problem: `The theme has no page ${JSON.stringify(page)}.` }
    html = (await server.render(Page, { store: storeOf(context), poweredBy: null, path: page.startsWith('/') ? page : '/', answers: null })).html
    css = await readFile(join(work, 'server.css'), 'utf8').catch(() => '')
  } catch (error) {
    return { images: [], problem: `The page threw while rendering: ${messageOf(error)}` }
  }
  const { width, height } = slices[device]
  // The container is the boundary; Chromium's own sandbox can't make its namespaces there (as in publish/main.ts).
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: false, timeout: stepMs })
  try {
    const tab = await browser.newPage({ viewport: { width, height: Math.round(width * 0.75) } })
    await tab.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()))
    await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`, { waitUntil: 'load', timeout: stepMs })
    const tall = await tab.evaluate(() => document.documentElement.scrollHeight)
    const images: string[] = []
    for (let y = 0; y < tall && images.length < maxPictureSlices; y += height) {
      const shot = await tab.screenshot({ type: 'jpeg', quality: 70, fullPage: true, timeout: stepMs, clip: { x: 0, y, width, height: Math.min(height, tall - y) } })
      images.push(shot.toString('base64'))
    }
    return { images, problem: null }
  } finally {
    await browser.close()
  }
}
