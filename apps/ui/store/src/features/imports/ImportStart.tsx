import { isApiError } from '@dripfunnel/shared/graphql'
import { LoadingState } from '@dripfunnel/shared/ui'
import { useEffect, useId, useRef, useState } from 'react'
import type { ShopifyConnection } from '../../api/imports'
import { fill, formatMegabytes, messages } from '../../messages'
import { tabKeyHandler } from '../common/tabKeys'
import { CurrencyChoice, currencyToSend, type FileCurrencies } from './CurrencyChoice'
import { useImportApi } from './importApi'
import { connectShopifyEnabled } from './importFlags'
import type { Mode } from './ImportPage'

const words = messages.imports

export type FileError = { kind: 'type' | 'empty' | 'cols'; name: string } | { kind: 'big'; name: string; size: number } | { kind: 'other'; name: string; message: string }

const errorWords = (error: FileError): { title: string; body: string } => {
  const e = words.fileErrors
  switch (error.kind) {
    case 'big':
      return { title: e.big.title, body: fill(e.big.body, { name: error.name, size: formatMegabytes(error.size) }) }
    case 'other':
      return { title: e.other.title, body: error.message }
    default:
      return { title: e[error.kind].title, body: fill(e[error.kind].body, { name: error.name }) }
  }
}

interface StartProps {
  mode: Mode
  readOnly: boolean
  checking: boolean
  fileError: FileError | null
  shopNote: 'failed' | null
  /** The plan that unlocks Import CSV from Shopify (null when it doesn't say), once the API has refused it. */
  locked: { plan: string | null } | null
  canUpgrade: boolean
  onMode: (mode: Mode) => void
  onFile: (file: File, currency: string | null) => void
  /** The store's pricing currency and the ones it prices by hand, for the currency a Shopify file's prices are in. */
  currencies: FileCurrencies
  onShopifyFiles: (products: File, inventory: File | null, currency: string | null) => void
  onTemplate: () => void
  onConnected: (shop: string) => void
}

/** Choose: a spreadsheet, Shopify (its export files, or a connected shop), or the template; the file's refusal said in CatImport's words. */
export const ImportStart = ({ mode, readOnly, checking, fileError, shopNote, locked, canUpgrade, currencies, onMode, onFile, onShopifyFiles, onTemplate, onConnected }: StartProps) => {
  const picker = useRef<HTMLInputElement>(null)
  const loading = useRef<HTMLDivElement>(null)
  // The card just used is disabled while it holds focus, so focus moves to the loading notice (WCAG 2.4.3).
  useEffect(() => {
    if (checking) loading.current?.focus()
  }, [checking])
  const choose = () => picker.current?.click()
  const [currency, setCurrency] = useState<string | null>(null)
  const s = words.sources
  const sources = [
    { key: 'file', ...s.file, selected: mode === 'file', disabled: readOnly || checking, onClick: () => onMode('file') },
    { key: 'shopify', ...s.shopify, selected: mode === 'shopify', disabled: readOnly || checking, onClick: () => onMode('shopify') },
    { key: 'template', ...s.template, selected: false, disabled: false, onClick: onTemplate },
  ]
  const said = fileError && errorWords(fileError)
  const inPanel = mode === 'file'
  const problem = said && !checking && (
    <div className="df-import-problem" role="alert">
      <strong>{said.title}</strong>
      <span>{said.body}</span>
      <span className="df-import-problem-actions">
        {mode !== 'shopify' && (
          <button type="button" onClick={choose} disabled={readOnly}>
            {words.fileErrors.chooseAnother}
          </button>
        )}
        <button type="button" onClick={onTemplate}>
          {words.fileErrors.template}
        </button>
      </span>
    </div>
  )
  return (
    <>
      <div className="df-import-sources">
        {sources.map((source) => (
          <button key={source.key} type="button" className="df-import-source" aria-pressed={source.key === 'template' ? undefined : source.selected} disabled={source.disabled} onClick={source.onClick}>
            <span className="df-import-source-title">{source.title}</span>
            <span className="df-import-source-body">{source.body}</span>
            <span className="df-import-source-cta">{checking && source.selected ? <><span className="df-import-spinner" aria-hidden="true" />{words.checking.file}</> : source.cta}</span>
          </button>
        ))}
      </div>
      {mode === 'file' && (
        <div className="df-import-card df-import-connect" aria-busy={checking}>
          <h2>{s.file.title}</h2>
          {problem}
          <CurrencyChoice currencies={currencies} chosen={currency} copy={s.file.currency} disabled={readOnly || checking} onChange={setCurrency} />
          <button type="button" className="df-button df-button--primary" disabled={readOnly || checking} onClick={choose}>
            {checking ? <><span className="df-import-spinner" aria-hidden="true" />{words.checking.file}</> : s.file.choose}
          </button>
        </div>
      )}
      <input
        ref={picker}
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="df-visually-hidden"
        tabIndex={-1}
        aria-label={s.file.cta}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file, currencyToSend(currency, currencies))
        }}
      />
      {checking && (
        <div ref={loading} tabIndex={-1} className="df-import-loading">
          <LoadingState label={words.checking.file} />
        </div>
      )}
      {!inPanel && problem}
      {mode === 'shopify' && <ShopifyImport busy={checking} note={shopNote} readOnly={readOnly} locked={locked} canUpgrade={canUpgrade} currencies={currencies} onFiles={onShopifyFiles} onConnected={onConnected} />}
    </>
  )
}

type ShopifyTab = 'csv' | 'connect'
const shopifyTabs: readonly ShopifyTab[] = ['connect', 'csv']

/** "Import from Shopify": Import CSV from Shopify, and beside it Connect Shopify once that is switched on. */
const ShopifyImport = ({ busy, note, readOnly, locked, canUpgrade, currencies, onFiles, onConnected }: { busy: boolean; currencies: StartProps['currencies']; note: 'failed' | null; readOnly: boolean; locked: StartProps['locked']; canUpgrade: boolean; onFiles: StartProps['onShopifyFiles']; onConnected: StartProps['onConnected'] }) => {
  const t = words.shopifyTabs
  const tabsId = useId()
  const [tab, setTab] = useState<ShopifyTab>(note === 'failed' ? 'connect' : 'csv')
  const buttons = useRef(new Map<ShopifyTab, HTMLButtonElement>())
  if (!connectShopifyEnabled) return <ShopifyCsv busy={busy} readOnly={readOnly} locked={locked} canUpgrade={canUpgrade} currencies={currencies} onFiles={onFiles} />
  return (
    <>
      <div className="df-import-tabs" role="tablist" aria-label={t.label} onKeyDown={tabKeyHandler(shopifyTabs, tab, setTab, (key) => buttons.current.get(key)?.focus())}>
        {shopifyTabs.map((key) => (
          <button key={key} ref={(el) => void (el ? buttons.current.set(key, el) : buttons.current.delete(key))} id={`${tabsId}-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`${tabsId}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>
            {t[key]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === 'connect' ? <ShopifyConnect note={note} onConnected={onConnected} /> : <ShopifyCsv busy={busy} readOnly={readOnly} locked={locked} canUpgrade={canUpgrade} currencies={currencies} onFiles={onFiles} />}
      </div>
    </>
  )
}

const ShopifyCsv = ({ busy, readOnly, locked, canUpgrade, currencies, onFiles }: { busy: boolean; currencies: StartProps['currencies']; readOnly: boolean; locked: StartProps['locked']; canUpgrade: boolean; onFiles: StartProps['onShopifyFiles'] }) => {
  const w = words.shopifyCsv
  const id = useId()
  const [products, setProducts] = useState<File | null>(null)
  const [inventory, setInventory] = useState<File | null>(null)
  const [currency, setCurrency] = useState<string | null>(null)
  if (locked)
    return (
      <div className="df-import-card df-import-connect">
        <h2>{w.title}</h2>
        <p className="df-import-problem" role="status">
          {canUpgrade ? (locked.plan ? fill(w.locked, { plan: locked.plan }) : w.lockedAnyPlan) : `${w.lockedAnyPlan} ${w.askOwner}`}
        </p>
      </div>
    )
  const pickers = [
    { key: 'products', ...w.products, tag: w.products.required, file: products, set: setProducts },
    { key: 'inventory', ...w.inventory, tag: w.inventory.optional, file: inventory, set: setInventory },
  ] as const
  return (
    <div className="df-import-card df-import-connect" aria-busy={busy}>
      <h2 id={id}>{w.title}</h2>
      <div className="df-import-files">
        {pickers.map((p) => (
          <div key={p.key} className="df-import-file">
            <span className="df-import-file-label">
              {p.label} <span className="df-import-hint">· {p.tag}</span>
            </span>
            <span className="df-import-hint">{p.hint}</span>
            <span className="df-import-file-row">
              <label className="df-button">
                {p.file ? w.change : w.choose}
                <input
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="df-visually-hidden"
                  aria-label={p.label}
                  disabled={readOnly || busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) p.set(file)
                  }}
                />
              </label>
              <span className="df-import-mono">{p.file?.name ?? w.none}</span>
            </span>
          </div>
        ))}
      </div>
      <CurrencyChoice currencies={currencies} chosen={currency} copy={w.currency} disabled={busy} onChange={setCurrency} />
      <button
        type="button"
        className="df-button df-button--primary"
        disabled={readOnly || busy || !products}
        onClick={() => products && onFiles(products, inventory, currencyToSend(currency, currencies))}
      >
        {busy ? <><span className="df-import-spinner" aria-hidden="true" />{words.checking.file}</> : w.check}
      </button>
    </div>
  )
}

const ShopifyConnect = ({ note, onConnected }: { note: 'failed' | null; onConnected: (shop: string) => void }) => {
  const { connectShopify, loadShopifyConnection } = useImportApi()
  const w = words.shopify
  const id = useId()
  const [connection, setConnection] = useState<ShopifyConnection | null>(null)
  const [shop, setShop] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [problem, setProblem] = useState<string | null>(note === 'failed' ? w.failed : null)

  useEffect(() => {
    let live = true
    loadShopifyConnection().then(
      (found) => {
        if (!live) return
        if (found.status === 'connected' && found.shop) return onConnected(found.shop)
        setConnection(found)
        if (found.status === 'expired') setProblem(w.expired)
      },
      () => live && setProblem(w.away),
    )
    return () => {
      live = false
    }
  }, [loadShopifyConnection, onConnected, w.expired, w.away])

  const connect = async () => {
    const name = shop.trim().replace(/\.myshopify\.com$/i, '')
    if (name === '') return setProblem(w.required)
    setConnecting(true)
    setProblem(null)
    try {
      window.location.assign(await connectShopify(`${name}.myshopify.com`))
    } catch (error) {
      setConnecting(false)
      const code = isApiError(error) ? error.code : null
      setProblem(code === 'INVALID_SHOP' ? fill(w.notFound, { shop: name }) : code === 'NOT_AVAILABLE' ? w.unavailable : w.away)
    }
  }

  if (connection && !connection.available)
    return (
      <div className="df-import-card df-import-connect">
        <p className="df-import-problem" role="status">
          {w.unavailable}
        </p>
      </div>
    )
  return (
    <div className="df-import-card df-import-connect">
      <h2 id={id}>{w.title}</h2>
      {problem && (
        <p className="df-import-problem" role="alert">
          {problem}
        </p>
      )}
      <form
        className="df-import-connect-row"
        aria-labelledby={id}
        onSubmit={(event) => {
          event.preventDefault()
          void connect()
        }}
      >
        <label className="df-import-shop">
          <input aria-label={w.address} value={shop} onChange={(event) => setShop(event.target.value)} placeholder={w.placeholder} autoComplete="off" spellCheck={false} />
          <span aria-hidden="true">{w.suffix}</span>
        </label>
        <button type="submit" className="df-button df-button--primary" disabled={connecting}>
          {connecting ? w.connecting : connection?.status === 'expired' ? w.again : w.connect}
        </button>
      </form>
      <p className="df-import-hint">{w.note}</p>
    </div>
  )
}
