import { formatMoney, minorOf } from '@dripfunnel/shared/format'
import { useId, useState } from 'react'
import { loadMarkets, loadPricing, type CurrencyPrice } from '../../api/productEditor'
import { fill, locale, messages } from '../../messages'
import type { Draft, DraftProblem } from '../common/productDraft'
import type { Update } from './EditorCards'

const words = messages.editor.price

const money = (p: Pick<CurrencyPrice, 'amount' | 'currency'>) => formatMoney({ amount: Number(p.amount), currency: p.currency }, locale)

/**
 * "Shoppers abroad" for a product without choices: each currency the store converts shows the price it was saved
 * with; each it prices by hand takes a typed price, and says it isn't for sale there until one is typed.
 */
export const PricesAbroad = ({ draft, update, disabled, currencies, converted, problems }: { draft: Draft; update: Update; disabled: boolean; currencies: readonly { code: string; mode: 'auto' | 'manual' }[]; converted: readonly CurrencyPrice[]; problems: readonly DraftProblem[] }) => {
  const id = useId()
  const version = draft.versions[0]
  if (!version || currencies.length === 0) return null
  const set = (code: string, text: string) => update((d) => ({ ...d, versions: d.versions.map((v, i) => (i === 0 ? { ...v, manualPrices: { ...v.manualPrices, [code]: text } } : v)) }))
  return (
    <div className="df-editor-abroad">
      <h3>{words.abroad}</h3>
      {currencies.map((c) => {
        if (c.mode === 'auto') {
          const saved = converted.find((p) => p.currency === c.code)
          return (
            <div key={c.code} className="df-editor-abroad-row">
              <span className="df-editor-meter">{c.code}</span>
              <span>{saved ? fill(words.auto, { price: money(saved) }) : words.autoNone}</span>
            </div>
          )
        }
        const typed = version.manualPrices[c.code] ?? ''
        const n = minorOf(typed, c.code)
        const bad = problems.includes('manual') && (n === 'invalid' || n === 0)
        return (
          <div key={c.code} className="df-editor-abroad-row">
            <label htmlFor={`${id}-${c.code}`} className="df-editor-meter">
              {c.code}
            </label>
            <span className="df-editor-abroad-manual">
              <input id={`${id}-${c.code}`} inputMode="decimal" aria-label={fill(words.manualLabel, { currency: c.code })} value={typed} readOnly={disabled} aria-invalid={bad} onChange={(e) => set(c.code, e.target.value)} />
              {typed.trim() === '' && <span className="df-editor-hint">{fill(words.manualMissing, { currency: c.code })}</span>}
              {bad && <span className="df-editor-problem">{fill(words.manualInvalid, { currency: c.code })}</span>}
            </span>
          </div>
        )
      })}
      {currencies.some((c) => c.mode === 'auto') && <p className="df-editor-hint">{words.autoNote}</p>}
    </div>
  )
}

type Markets = { kind: 'closed' } | { kind: 'loading' } | { kind: 'failed' } | { kind: 'shown'; rows: { name: string; price: CurrencyPrice | null }[] }

/** "Price per market": each active market's price for the first version, worked out by the API when asked (O14). */
export const MarketPrices = ({ productId }: { productId: string }) => {
  const [markets, setMarkets] = useState<Markets>({ kind: 'closed' })
  const show = () => {
    setMarkets({ kind: 'loading' })
    void loadMarkets()
      // One answer per market, each priced by the API with its currency, rounding and adjustment.
      .then((list) => Promise.all(list.map(async (m) => ({ name: m.name, price: (await loadPricing(productId, m.id))[0]?.inMarket ?? null }))))
      .then(
        (rows) => setMarkets({ kind: 'shown', rows }),
        () => setMarkets({ kind: 'failed' }),
      )
  }
  return (
    <div className="df-editor-abroad">
      <h3>{words.perMarket}</h3>
      {markets.kind === 'closed' && (
        <button type="button" className="df-editor-link" onClick={show}>
          {words.perMarketShow}
        </button>
      )}
      {markets.kind === 'loading' && <p className="df-editor-hint">{messages.editor.loading}</p>}
      {markets.kind === 'failed' && <p className="df-editor-problem">{words.perMarketFailed}</p>}
      {markets.kind === 'shown' &&
        markets.rows.map((m) => (
          <div key={m.name} className="df-editor-abroad-row">
            <span>{m.name}</span>
            <span>{m.price ? money(m.price) : words.perMarketNone}</span>
          </div>
        ))}
      <p className="df-editor-hint">{words.perMarketNote}</p>
    </div>
  )
}
