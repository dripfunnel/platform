import { isApiError } from '@dripfunnel/shared/graphql'
import { minorOf } from '@dripfunnel/shared/format'
import { useEffect, useState } from 'react'
import { loadProduct, loadProductBasics, saveProduct, type EditorProduct } from '../../api/productEditor'
import { loadProductStock, loadWarehouses, setStock, type Warehouse } from '../../api/stock'
import { fill, formatCount, messages, plural } from '../../messages'
import { draftOf, inputOf, quantityOf, stockChangesOf, versionKey, type Draft } from '../common/productDraft'

const words = messages.products.quick

type Loaded = { product: EditorProduct; currency: string; draft: Draft; home: Warehouse | null }

/**
 * CatList's quick edit: each version's price and its stock at the default location, saved as the editor
 * saves them (the product's next revision, then the counts). A Stock-only supplier changes the counts alone.
 */
export const QuickEdit = ({ productId, side, canPrice, canStock, onDone, onCancel }: { productId: string; side: 'merchant' | 'supplier'; canPrice: boolean; canStock: boolean; onDone: (text: string) => void; onCancel: () => void }) => {
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([loadProduct(productId), loadProductBasics(), loadProductStock(productId), loadWarehouses()]).then(
      ([product, basics, levels, warehouses]) => {
        const pricing = product?.pricingCurrency ?? basics.pricingCurrency
        if (!live) return
        if (!product || !pricing) return setLoaded('failed')
        const start = draftOf(product, pricing, { units: basics.unitSystem, levels })
        setLoaded({ product, currency: pricing, draft: start, home: warehouses.find((w) => w.isDefault) ?? warehouses[0] ?? null })
        setDraft(start)
      },
      () => live && setLoaded('failed'),
    )
    return () => {
      live = false
    }
  }, [productId])

  if (loaded === null || draft === null)
    return loaded === 'failed' ? (
      <p className="df-products-quick-note" role="alert">
        {words.failed}
      </p>
    ) : (
      <p className="df-products-quick-note">{words.loading}</p>
    )
  if (loaded === 'failed') return null

  const { product, currency, home } = loaded
  const physical = draft.kind === 'physical' && home !== null
  const live = draft.versions.filter((v) => !v.removed)
  const priceChanged = (i: number) => draft.versions[i]?.price !== loaded.draft.versions[i]?.price
  const stockText = (key: string) => (home ? (draft.stock[key]?.[home.id] ?? '') : '')
  const stockChanged = (key: string) => home !== null && stockText(key) !== (loaded.draft.stock[key]?.[home.id] ?? '')
  const changes = draft.versions.reduce((n, v, i) => n + (priceChanged(i) ? 1 : 0) + (stockChanged(versionKey(v.choices)) ? 1 : 0), 0)

  const save = async () => {
    if (changes === 0) return onCancel()
    // Prices are checked only where they can be changed: counts alone never wait on a price.
    if (canPrice && live.some((v) => { const p = minorOf(v.price, currency); return p === null || p === 'invalid' || p <= 0 })) return setProblem(words.priceMissing)
    if (home && live.some((v) => quantityOf(stockText(versionKey(v.choices))) === 'invalid')) return setProblem(words.stockInvalid)
    setBusy(true)
    setProblem(null)
    let base = loaded
    if (canPrice && draft.versions.some((_, i) => priceChanged(i))) {
      try {
        const done = await saveProduct(product.id, product.revision, inputOf(draft, currency, side), false)
        // The prices are stored at a new revision: they become the baseline, so a retry sends only the counts.
        base = { ...loaded, product: { ...product, revision: done.revision }, draft: { ...draft, stock: loaded.draft.stock } }
        setLoaded(base)
      } catch (error) {
        setProblem(isApiError(error, 'STALE_REVISION') ? words.stale : words.failed)
        setBusy(false)
        return
      }
    }
    try {
      const ids = new Map(product.versions.map((v) => [versionKey(v.choices), v.id]))
      await setStock(stockChangesOf(draft, base.draft, (key) => ids.get(key)))
      onDone(fill(plural(words.saved, changes), { count: formatCount(changes), name: product.name }))
    } catch {
      setProblem(base === loaded ? words.failed : words.stockFailed)
      setBusy(false)
    }
  }

  const setVersion = (i: number, price: string) => setDraft((d) => d && { ...d, versions: d.versions.map((v, j) => (j === i ? { ...v, price } : v)) })
  const setCount = (key: string, text: string) => home && setDraft((d) => d && { ...d, stock: { ...d.stock, [key]: { ...d.stock[key], [home.id]: text } } })

  return (
    <div className="df-products-quick" role="region" aria-label={fill(words.title, { what: product.name })}>
      <div className="df-products-quick-head">
        <strong>{fill(words.title, { what: draft.options.length > 0 ? fill(plural(words.versions, live.length), { count: formatCount(live.length) }) : words.priceAndStock })}</strong>
        <span>{physical && home ? fill(words.where, { currency, warehouse: home.name }) : fill(words.whereNoStock, { currency })}</span>
      </div>
      {draft.versions.map((v, i) => {
        if (v.removed) return null
        const name = v.choices.join(' / ') || words.thisProduct
        const key = versionKey(v.choices)
        return (
          <div key={key} className="df-products-quick-row">
            <span>{name}</span>
            <input inputMode="decimal" aria-label={fill(words.price, { name })} value={v.price} readOnly={!canPrice || busy} onChange={(event) => setVersion(i, event.target.value)} />
            {physical && <input inputMode="numeric" aria-label={fill(words.stock, { name })} value={stockText(key)} placeholder={words.countPlaceholder} readOnly={!canStock || busy} onChange={(event) => setCount(key, event.target.value)} />}
            <span className="df-products-quick-changed">{priceChanged(i) || stockChanged(key) ? words.changed : ''}</span>
          </div>
        )
      })}
      {problem && (
        <p className="df-products-quick-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="df-products-quick-actions">
        <button type="button" className="df-button" disabled={busy} onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy} onClick={() => void save()}>
          {changes > 0 ? fill(plural(words.saveN, changes), { count: formatCount(changes) }) : words.save}
        </button>
      </div>
    </div>
  )
}
