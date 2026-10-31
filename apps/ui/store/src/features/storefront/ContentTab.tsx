import { ErrorState, LoadingState, StatusPill } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentRow, ContentStatus } from '../../api/content'
import { fill, formatTime, messages } from '../../messages'
import { ContentEditor } from './ContentEditor'
import type { StorefrontApi } from './storefrontApi'
import './content.css'

const words = messages.storefront.content

type List = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; rows: ContentRow[]; next: string | null; more: 'idle' | 'loading' | 'failed' }

const pills: Record<ContentStatus, { tone: 'success' | 'neutral' | 'info'; icon: 'ok' | 'pen' | 'clock' }> = {
  published: { tone: 'success', icon: 'ok' },
  draft: { tone: 'neutral', icon: 'pen' },
  scheduled: { tone: 'info', icon: 'clock' },
}

export interface ContentTabProps {
  api: StorefrontApi
  canEdit: boolean
  /** The post open in the editor ('new' for one not saved yet), kept in the address. */
  entry: string | undefined
  onEntry: (entry: string | undefined) => void
  host: string | null
  shopName: string
  onToast: (text: string) => void
}

/** Storefront › Journal (StorefrontContent; FIRST-RELEASE §14): the store's posts. */
export const ContentTab = ({ api, canEdit, entry, onEntry, host, shopName, onToast }: ContentTabProps) => {
  const [list, setList] = useState<List>({ kind: 'loading' })
  const latest = useRef(0)
  const load = useCallback(() => {
    const ask = ++latest.current
    setList({ kind: 'loading' })
    api.loadContentList(null).then(
      (page) => ask === latest.current && setList({ kind: 'ready', rows: page.rows, next: page.next, more: 'idle' }),
      () => ask === latest.current && setList({ kind: 'error' }),
    )
  }, [api])
  useEffect(load, [load])

  const more = () => {
    if (list.kind !== 'ready' || !list.next) return
    const ask = latest.current
    setList({ ...list, more: 'loading' })
    api.loadContentList(list.next).then(
      (page) => ask === latest.current && setList((was) => (was.kind === 'ready' ? { ...was, rows: [...was.rows, ...page.rows], next: page.next, more: 'idle' } : was)),
      () => ask === latest.current && setList((was) => (was.kind === 'ready' ? { ...was, more: 'failed' } : was)),
    )
  }

  const w = words.journal
  const metaOf = (r: ContentRow) => {
    const date = formatTime(r.publishAt ?? r.updatedAt)
    const when = r.status === 'scheduled' ? fill(w.goesLive, { date }) : date
    return r.author ? fill(w.byline, { when, author: r.author }) : when
  }
  // A reader has nothing to write, so `new` shows them the list.
  if (entry !== undefined && (canEdit || entry !== 'new')) {
    const rows = list.kind === 'ready' ? list.rows : []
    return (
      <ContentEditor
        id={entry === 'new' ? null : entry}
        api={api}
        canEdit={canEdit}
        host={host}
        shopName={shopName}
        titleAt={(path) => rows.find((r) => r.path === path)?.title ?? null}
        onBack={() => onEntry(undefined)}
        onToast={onToast}
        onDone={(text) => {
          onToast(text)
          onEntry(undefined)
          load()
        }}
      />
    )
  }

  if (list.kind === 'loading') return <LoadingState label={words.loading} />
  if (list.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />

  return (
    <div className="df-sfc">
      <div className="df-sfc-head">
        <div>
          <h2>{w.title}</h2>
          <p>{w.sub}</p>
        </div>
        {canEdit && (
          <button type="button" className="df-button df-button--primary" onClick={() => onEntry('new')}>
            {w.add}
          </button>
        )}
      </div>
      {list.rows.length === 0 ? (
        <p className="df-sfc-empty">{w.empty}</p>
      ) : (
        <ul className="df-sfc-rows">
          {list.rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="df-sfc-row" onClick={() => onEntry(r.id)}>
                <span className="df-sfc-name">
                  <strong>{r.title}</strong>
                  <span className="df-sfc-path">{r.path}</span>
                </span>
                <StatusPill tone={pills[r.status].tone} icon={pills[r.status].icon} label={words.status[r.status]} />
                <span className="df-sfc-meta">{metaOf(r)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.next && (
        <div className="df-sfc-more">
          {list.more === 'failed' && (
            <span className="df-sf-problem" role="alert">
              {words.moreFailed}
            </span>
          )}
          <button type="button" className="df-button" disabled={list.more === 'loading'} onClick={more}>
            {words.more}
          </button>
        </div>
      )}
      <span className="df-sfc-foot">{w.foot}</span>
    </div>
  )
}
