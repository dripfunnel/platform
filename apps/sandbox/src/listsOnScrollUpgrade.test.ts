import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyCodemods, coreUpgradeNotes, notesBetween } from '@dripfunnel/storefront-core/guard'

// #1570: the 2.1.0 codemods bring scroll-loading lists to a store made before them.
const themesDir = fileURLToPath(new URL('../../../templates/storefront/themes/', import.meta.url))
const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel)).flatMap((name) => {
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
  })
const shipped = (theme: string) =>
  new Map(
    [...walk(join(themesDir, theme), 'src/theme'), ...walk(join(themesDir, theme), 'content')]
      .filter((path) => /\.(tsx|css|json)$/.test(path))
      .map((path) => [path, readFileSync(join(themesDir, theme, path), 'utf8').replace(/\r\n/g, '\n')] as const),
  )
const codemods = notesBetween('2.0.0', '2.1.0', coreUpgradeNotes).flatMap((n) => n.codemods)

/** The theme with every codemod undone, last first: what a store made before this change holds. */
const undone = (theme: ReadonlyMap<string, string>) => {
  const files = new Map(theme)
  for (const c of [...codemods].reverse()) {
    if (c.kind !== 'replace') continue
    for (const path of files.keys()) {
      const text = files.get(path) ?? ''
      if (text.includes(c.replace) && c.paths.some((g) => new RegExp(`^${g.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`).test(path))) files.set(path, text.replace(c.replace, c.find))
    }
  }
  return files
}

describe.each(['baseline', 'beauty', 'classic', 'electronics', 'fashion', 'grocery', 'home', 'jewelry'])('Account › Orders and the Blog for a %s store made before core 2.1.0', (key) => {
  const now = shipped(key)
  const before = undone(now)

  it('has the Load more buttons back in the fixture, so the test means something', () => {
    expect(before.get('src/theme/components/interactive/AccountView.tsx')).toContain("t('shop.orders.loadMore')")
    expect(before.get('src/theme/components/interactive/BlogView.tsx')).toContain("t('pages.blog.older')")
  })

  it('brings the shipped theme back exactly, and a second run changes nothing', () => {
    const once = applyCodemods(before, codemods)
    expect(once).toEqual(now)
    expect(applyCodemods(once, codemods)).toEqual(once)
  })

})

// A store made before core 0.12.0 (#1385) has the product grid's Load more button; Market ships it still.
describe.each(['baseline', 'classic', 'market'])('the product grids of a %s store made before core 0.12.0', (key) => {
  const loadMore = `/** "Load more" through fetchMore, and the retry when the next page didn't load. */
export const LoadMore = ({ listing }: { listing: Listing }) => {
  const { t } = useStorefront()
  if (!listing.hasMore) return null
  return (
    <div className={styles.more}>
      {listing.moreFailed ? (
        <p className={styles.muted} role="alert">
          {t('shop.listing.moreFailed')}
        </p>
      ) : null}
      <button type="button" className={styles.secondary} disabled={listing.loadingMore} onClick={listing.fetchMore}>
        {t('shop.listing.more')}
      </button>
    </div>
  )
}
`
  const now = shipped(key)
  const before = new Map(undone(now))
  const filters = 'src/theme/components/interactive/Filters.tsx'
  const results = 'src/theme/components/ListingResults.tsx'
  // Classic and Baseline already scroll-load; the fixture is their Filters as #1385 found them.
  const old = (text: string) => text.replace(/\/\*\* Infinite scroll:[\s\S]*$/, loadMore).replace('useLoadOnScroll, ', '')
  if (key !== 'market') {
    before.set(filters, old(before.get(filters) ?? ''))
    before.set(results, (before.get(results) ?? '').replaceAll('MoreOnScroll', 'LoadMore'))
  }

  it('has the Load more button in the fixture, so the test means something', () => {
    expect(before.get(filters)).toContain('export const LoadMore')
    expect(before.get(results)).toContain('<LoadMore listing={listing} />')
  })

  it('loads the next page on scroll, with no Load more button', () => {
    const after = applyCodemods(before, codemods)
    expect(after.get(filters)).toContain('export const MoreOnScroll')
    expect(after.get(filters)).toMatch(/import \{[^}]*\buseLoadOnScroll\b[^}]*\} from '@dripfunnel\/storefront-core\/theme'/)
    expect(after.get(filters)).not.toContain('shop.listing.more\')')
    expect(after.get(results)).toContain('<MoreOnScroll listing={listing} />')
    expect(after.get(results)).not.toContain('LoadMore')
    expect(applyCodemods(after, codemods)).toEqual(after)
  })
})
