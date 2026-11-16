---
'@dripfunnel/storefront-core': major
---

A product whose version has Track stock off no longer says "In stock" on the live site (#1278): the starting themes (baseline, classic, market) show the stock line only when `useProduct().stock.available` is a number, which core already gives (null for an untracked version). `@dripfunnel/storefront-core` itself does not change; this entry carries the theme edit to stores that already have their own copy of a starting theme. A store's look changes (a line disappears for an untracked version), so it is a major, and it reaches a store at its merchant's next publish, with the release it rides in.

Upgrade notes, for the release card's `coreUpgradeNotes` entry: in `src/theme/pages/ProductPage.tsx`, show the stock `<p role="status">` only when an option is still to choose or the chosen version's stock is tracked. This `replace` codemod makes that edit in a theme still holding a starting theme's text (it changes nothing in a file whose text differs; the migration agent gets the note instead). The new starting themes read exactly as the replacement does.

```
kind: replace
paths: ['src/theme/pages/ProductPage.tsx']
find:
            <p className={styles.stock} role="status">
              {firstMissing ? t('shop.product.choose', { option: firstMissing.name }) : page.stock?.inStock ? t('shop.product.inStock') : t('shop.product.outOfStock')}
            </p>
replace:
            {firstMissing || typeof page.stock?.available === 'number' ? (
              <p className={styles.stock} role="status">
                {firstMissing ? t('shop.product.choose', { option: firstMissing.name }) : page.stock?.inStock ? t('shop.product.inStock') : t('shop.product.outOfStock')}
              </p>
            ) : null}
```
