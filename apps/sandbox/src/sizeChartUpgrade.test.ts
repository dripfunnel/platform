import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyCodemods, coreUpgradeNotes, notesBetween } from '@dripfunnel/storefront-core/guard'

// #1462: the 0.14.0 codemods turn the Classic theme as it was before #1326 into the one the template ships now.
const classic = (path: string) => readFileSync(fileURLToPath(new URL(`../../../templates/storefront/themes/classic/${path}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const pagePath = 'src/theme/pages/ProductPage.tsx'
const cssPath = 'src/theme/styles/product.module.css'
const linkRule = /\n\.sizeLink \{[^}]*\}\n/g
const focusRule = /\n\.sizeLink:focus-visible \{[^}]*\}\n/g

describe('the size chart link for a Classic store made before core 0.14.0', () => {
  const shippedPage = classic(pagePath)
  const shippedCss = classic(cssPath)
  const before = new Map([
    [pagePath, shippedPage.replace('RichText, SizeChart, ', 'RichText, ').replace(/ {12}<SizeChart [^\n]*\n/, '')],
    [cssPath, shippedCss.replace(focusRule, '').replace(linkRule, '')],
  ])
  const codemods = notesBetween('0.13.0', '0.14.0', coreUpgradeNotes).flatMap((n) => n.codemods)

  it('has the link taken out of the fixture, so the test means something', () => {
    expect(before.get(pagePath)).not.toContain('SizeChart')
    expect(before.get(cssPath)).not.toContain('.sizeLink')
  })

  it('brings the shipped Classic product page back exactly and its link styles in once, and a second run changes nothing', () => {
    const once = applyCodemods(before, codemods)
    expect(once.get(pagePath)).toBe(shippedPage)
    const css = once.get(cssPath) ?? ''
    for (const rule of [...(shippedCss.match(linkRule) ?? []), ...(shippedCss.match(focusRule) ?? [])]) expect(css.split(rule.trim())).toHaveLength(2)
    expect(applyCodemods(once, codemods)).toEqual(once)
  })
})
