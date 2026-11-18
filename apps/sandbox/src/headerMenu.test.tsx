import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { completeStore, createShopClient, PrefilledProvider, StorefrontProvider } from '@dripfunnel/storefront-core'
import { applyCodemods, coreUpgradeNotes, notesBetween } from '@dripfunnel/storefront-core/guard'

// #1481: the header's menu always has its fixed links around the merchant's items, as a live build draws it (a page's built
// answers), and a store made before it gets the same header from core's upgrade.

// The themes' own source, loaded by path: the sandbox never typechecks a theme (its CSS Modules and packages are the theme's own).
type LayoutComponent = (props: { children: ReactNode }) => ReactNode
const layoutPath = (theme: string) => fileURLToPath(new URL(`../../../templates/storefront/themes/${theme}/src/theme/components/Layout.tsx`, import.meta.url))
const layoutOf = async (theme: string): Promise<LayoutComponent> => ((await import(/* @vite-ignore */ layoutPath(theme))) as { Layout: LayoutComponent }).Layout
const ClassicLayout = await layoutOf('classic')
const BaselineLayout = await layoutOf('baseline')

const read = (theme: string) => readFileSync(layoutPath(theme), 'utf8').replace(/\r\n/g, '\n')

const store = completeStore({ name: 'Baby Cloth', mainLanguage: 'en', pricingCurrency: 'USD', pricesIncludeTax: false, timeZone: 'UTC' })
const row = (id: string, label: string, slug: string, children: { id: string; label: string; slug: string }[] = []) => ({
  id,
  label,
  kind: 'collection',
  collectionSlug: slug,
  url: null,
  children: children.map((c) => ({ id: c.id, label: c.label, kind: 'collection', collectionSlug: c.slug, url: null })),
})
// What a live build holds for the menu (as `useMenu` shapes it) and for the first twenty collections.
const menuOf = (rows: ReturnType<typeof row>[]) => rows.map((r) => ({ id: r.id, label: r.label, href: `/collections/${r.collectionSlug}/`, children: r.children.map((c) => ({ id: c.id, label: c.label, href: `/collections/${c.collectionSlug}/`, children: [] })) }))
const collections = [
  { id: 'c1', name: 'Baby Sleepwear', href: '/collections/baby-sleepwear/' },
  { id: 'c2', name: 'Newborn Essentials', href: '/collections/newborn-essentials/' },
]

/** The addresses of the header's nav links, in order, as a built page holds them (the theme's own words aren't loaded here). */
const headerLinks = (Layout: LayoutComponent, rows: ReturnType<typeof row>[]): string[] => {
  const answers = new Map<string, unknown>([
    ['menu', menuOf(rows)],
    [JSON.stringify(['collections', 20]), collections],
  ])
  const html = renderToString(
    <StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-US', mode: 'live', poweredBy: null }}>
      <PrefilledProvider value={{ answers: { has: (k) => answers.has(k), get: (k) => answers.get(k) } }}>
        <Layout>
          <p>page</p>
        </Layout>
      </PrefilledProvider>
    </StorefrontProvider>,
  )
  const nav = /<nav[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? ''
  return [...nav.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1] ?? '')
}

describe('the Classic header menu', () => {
  it('stays as it was while the menu is empty: Home, Shop all, every collection, About, Contact', () => {
    expect(headerLinks(ClassicLayout, [])).toEqual(['/', '/collections/all/', '/collections/baby-sleepwear/', '/collections/newborn-essentials/', '/about/', '/contact/'])
  })

  it('keeps Shop all, About and Contact around the merchant’s only item, and shows it in place of the automatic collections', () => {
    expect(headerLinks(ClassicLayout, [row('m1', 'Newborn Essentials', 'newborn-essentials')])).toEqual(['/', '/collections/all/', '/collections/newborn-essentials/', '/about/', '/contact/'])
  })

  it('puts several items, with their children, between Shop all and About, in the merchant’s order', () => {
    const links = headerLinks(ClassicLayout, [row('m1', 'Zebra', 'zebra', [{ id: 'k1', label: 'Stripes', slug: 'stripes' }]), row('m2', 'Apple', 'apple')])
    expect(links).toEqual(['/', '/collections/all/', '/collections/zebra/', '/collections/stripes/', '/collections/apple/', '/about/', '/contact/'])
  })
})

describe('the Baseline header menu', () => {
  it('shows Shop, About and Contact with an empty menu', () => {
    expect(headerLinks(BaselineLayout, [])).toEqual(['/collections/all/', '/about/', '/contact/'])
  })

  it('keeps Shop, About and Contact around the merchant’s items', () => {
    expect(headerLinks(BaselineLayout, [row('m1', 'Newborn Essentials', 'newborn-essentials'), row('m2', 'Sale', 'sale')])).toEqual(['/collections/all/', '/collections/newborn-essentials/', '/collections/sale/', '/about/', '/contact/'])
  })
})

// The header as it shipped before #1481, to show the upgrade brings a store made before it to the shipped one.
const oldClassicNav = `              <Link href="/" className={styles.navLink}>
                {t('common.nav.home')}
              </Link>
              {menu.items.length ? (
                menu.items.map((item) => <NavItem key={item.id} item={item} />)
              ) : (
                <>
                  <Link href="/collections/all/" className={styles.navLink}>
                    {t('common.nav.shopAll')}
                  </Link>
                  {collections.map((c) => (
                    <Link key={c.id} href={c.href} className={styles.navLink}>
                      {c.name}
                    </Link>
                  ))}
                  <Link href="/about/" className={styles.navLink}>
                    {t('common.nav.about')}
                  </Link>
                  <Link href="/contact/" className={styles.navLink}>
                    {t('common.nav.contact')}
                  </Link>
                </>
              )}
            </nav>`
const oldBaselineNav = `              {menu.items.length ? (
                menu.items.map((item) => <NavItem key={item.id} item={item} />)
              ) : (
                <Link href="/collections/all/" className={styles.navLink}>
                  {t('common.nav.shop')}
                </Link>
              )}
              <Link href="/about/" className={styles.navLink}>`

describe('the header for a store made before #1481', () => {
  const path = 'src/theme/components/Layout.tsx'
  const codemods = notesBetween('0.14.0', '1.0.0', coreUpgradeNotes).flatMap((n) => n.codemods)

  it.each([
    ['Classic', 'classic', oldClassicNav],
    ['Baseline', 'baseline', oldBaselineNav],
  ])('brings the shipped %s header back exactly from the one before, and a second run changes nothing', (_, theme, old) => {
    const shipped = read(theme)
    const newNav = codemods.find((m) => m.kind === 'replace' && m.find === old)
    expect(newNav?.kind === 'replace' ? shipped.includes(newNav.replace) : false).toBe(true)
    const before = new Map([[path, shipped.replace((newNav?.kind === 'replace' ? newNav.replace : ''), old)]])
    expect(before.get(path)).not.toBe(shipped)
    const once = applyCodemods(before, codemods)
    expect(once.get(path)).toBe(shipped)
    expect(applyCodemods(once, codemods).get(path)).toBe(shipped)
  })

  it('leaves a theme whose header is its own as it is', () => {
    const custom = new Map([[path, "export const Layout = () => <nav><a href='/'>Home</a></nav>\n"]])
    expect(applyCodemods(custom, codemods).get(path)).toBe(custom.get(path))
  })
})
