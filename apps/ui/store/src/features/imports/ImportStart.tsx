import { isApiError } from '@dripfunnel/shared/graphql'
import { LoadingState } from '@dripfunnel/shared/ui'
import { useEffect, useId, useRef, useState } from 'react'
import type { ShopifyConnection } from '../../api/imports'
import { fill, formatCount, messages } from '../../messages'
import { useImportApi } from './importApi'
import type { Mode } from './ImportPage'

const words = messages.imports

export type FileError = { kind: 'type' | 'empty' | 'cols'; name: string } | { kind: 'big'; name: string; size: number } | { kind: 'other'; name: string; message: string }

const errorWords = (error: FileError): { title: string; body: string } => {
  const e = words.fileErrors
  switch (error.kind) {
    case 'big':
      return { title: e.big.title, body: fill(e.big.body, { name: error.name, size: fill(e.megabytes, { size: formatCount(Math.round((error.size / 1024 / 1024) * 10) / 10) }) }) }
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
  onMode: (mode: Mode) => void
  onFile: (file: File) => void
  onTemplate: () => void
  onConnected: (shop: string) => void
}

/** Choose: a spreadsheet, a Shopify shop, or the template; the file's refusal said in CatImport's words. */
export const ImportStart = ({ mode, readOnly, checking, fileError, shopNote, onMode, onFile, onTemplate, onConnected }: StartProps) => {
  const picker = useRef<HTMLInputElement>(null)
  const choose = () => picker.current?.click()
  const s = words.sources
  const sources = [
    { key: 'file', ...s.file, selected: mode === 'file', disabled: readOnly, onClick: choose },
    { key: 'shopify', ...s.shopify, selected: mode === 'shopify', disabled: readOnly, onClick: () => onMode('shopify') },
    { key: 'template', ...s.template, selected: false, disabled: false, onClick: onTemplate },
  ]
  const said = fileError && errorWords(fileError)
  return (
    <>
      <div className="df-import-sources">
        {sources.map((source) => (
          <button key={source.key} type="button" className="df-import-source" aria-pressed={source.key === 'template' ? undefined : source.selected} disabled={source.disabled} onClick={source.onClick}>
            <span className="df-import-source-title">{source.title}</span>
            <span className="df-import-source-body">{source.body}</span>
            <span className="df-import-source-cta">{source.cta}</span>
          </button>
        ))}
      </div>
      <input
        ref={picker}
        type="file"
        accept=".csv,text/csv"
        className="df-visually-hidden"
        tabIndex={-1}
        aria-label={s.file.cta}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
      {checking && <LoadingState label={mode === 'shopify' ? words.checking.shopify : words.checking.file} />}
      {said && !checking && (
        <div className="df-import-problem" role="alert">
          <strong>{said.title}</strong>
          <span>{said.body}</span>
          <span className="df-import-problem-actions">
            <button type="button" onClick={choose} disabled={readOnly}>
              {words.fileErrors.chooseAnother}
            </button>
            <button type="button" onClick={onTemplate}>
              {words.fileErrors.template}
            </button>
          </span>
        </div>
      )}
      {mode === 'shopify' && !checking && <ShopifyConnect note={shopNote} onConnected={onConnected} />}
    </>
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
