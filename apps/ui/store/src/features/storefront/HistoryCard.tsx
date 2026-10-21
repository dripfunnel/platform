import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { historyPageSize, type StorefrontTemplate, type StorefrontVersion } from '../../api/storefront'
import { fill, formatTime, messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { templateName } from './overviewView'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.history
const refusal = refusalIn(words.refused)

export interface HistoryCardProps {
  templates: readonly StorefrontTemplate[]
  canEdit: boolean
  api: StorefrontApi
  /** Changes when the live version may have moved, so the list is read again. */
  liveNumber: number | null
  onWent: (toast: string) => void
}

/** Site settings › Version history (PortalStorefront): kept for the plan's days, Live, and Go back to this. */
export const HistoryCard = ({ templates, canEdit, api, liveNumber, onWent }: HistoryCardProps) => {
  const titleId = useId()
  const [rows, setRows] = useState<StorefrontVersion[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<StorefrontVersion | null>(null)
  const working = useRef(false)
  const latest = useRef(0)
  const label = (v: StorefrontVersion) => v.label ?? fill(words.templateLabel, { template: templateName(templates, v.template) })

  const load = useCallback(
    (before: number | null) => {
      const ask = ++latest.current
      if (before === null) setError(null)
      api.loadHistory(before).then(
        (page) => {
          if (ask !== latest.current) return
          setRows((was) => (before === null ? page : [...(was ?? []), ...page]))
          setMore(page.length >= historyPageSize)
        },
        () => ask === latest.current && setError(words.error),
      )
    },
    [api],
  )
  useEffect(() => load(null), [load, liveNumber])

  const goBack = (v: StorefrontVersion) => {
    setAsking(null)
    if (working.current) return
    working.current = true
    setError(null)
    api.goBackToVersion(v.number).then(
      () => {
        working.current = false
        onWent(fill(words.done, { number: String(v.number) }))
      },
      (e: unknown) => {
        working.current = false
        setError(refusal(e))
      },
    )
  }

  return (
    <section className="df-sf-card df-sf-history" aria-labelledby={titleId}>
      <div className="df-sf-card-head">
        <h2 id={titleId}>{words.title}</h2>
        <p className="df-sf-lede">{words.lede}</p>
      </div>
      {rows === null && !error && (
        <p className="df-sf-lede" role="status">
          {words.loading}
        </p>
      )}
      {error && (
        <p className="df-sf-failure" role="alert">
          {error}
        </p>
      )}
      {rows === null && error && (
        <button type="button" className="df-button df-button--small df-sf-history-retry" onClick={() => load(null)}>
          {words.retry}
        </button>
      )}
      {rows && rows.length === 0 && <p className="df-sf-lede">{words.empty}</p>}
      {rows && rows.length > 0 && (
        <ul>
          {rows.map((v) => (
            <li key={v.id}>
              <span className="df-sf-history-what">
                <strong>{fill(words.row, { number: String(v.number), label: label(v) })}</strong>
                <span>{formatTime(v.publishedAt)}</span>
              </span>
              {v.live && <span className="df-sf-history-live">{words.live}</span>}
              {canEdit && !v.live && (
                <button type="button" className="df-button df-button--small" onClick={() => (setError(null), setAsking(v))}>
                  {words.back}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {more && rows && (
        <button type="button" className="df-sf-link" onClick={() => load(rows.at(-1)?.number ?? null)}>
          {words.more}
        </button>
      )}
      <ConfirmDialog
        open={asking !== null}
        title={fill(words.askTitle, { number: String(asking?.number ?? '') })}
        target={asking ? fill(words.row, { number: String(asking.number), label: label(asking) }) : ''}
        consequence={asking ? fill(words.askBody, { label: label(asking) }) : ''}
        confirmLabel={words.confirm}
        cancelLabel={words.cancel}
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && goBack(asking)}
      />
    </section>
  )
}
