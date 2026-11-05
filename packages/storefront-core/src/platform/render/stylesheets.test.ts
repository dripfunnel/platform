// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableCSSFileLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
import { expect, it } from 'vitest'
import { swapStylesheets } from './studio'

it('loads each new stylesheet before the old ones leave, and keeps one that stays (#1240)', async () => {
  const link = (href: string) => Object.assign(document.createElement('link'), { rel: 'stylesheet', href })
  document.head.append(link('https://frame.example/assets/entry-A.css'), link('https://frame.example/assets/entry-KEEP.css'))
  const swapped = swapStylesheets(['https://frame.example/assets/entry-B.css', 'https://frame.example/assets/entry-KEEP.css'])
  const hrefs = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href)
  expect(hrefs()).toEqual(['https://frame.example/assets/entry-A.css', 'https://frame.example/assets/entry-KEEP.css', 'https://frame.example/assets/entry-B.css'])
  document.querySelector<HTMLLinkElement>('link[href$="entry-B.css"]')?.dispatchEvent(new Event('load'))
  await swapped
  expect(hrefs()).toEqual(['https://frame.example/assets/entry-KEEP.css', 'https://frame.example/assets/entry-B.css'])
})
