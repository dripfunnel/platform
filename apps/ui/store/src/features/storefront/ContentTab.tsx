import { ErrorState, LoadingState, StatusPill } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentKind, ContentRow, ContentStatus } from '../../api/content'
import { fill, formatTime, messages } from '../../messages'
import type { StorefrontApi } from './storefrontApi'
import './content.css'

const words = messages.storefront.content

type List = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; rows: ContentRow[]; custom: string[]; next: string | null; more: 'idle' | 'loading' | 'failed' }

const pills: Record<ContentStatus, { tone: 'success' | 'neutral' | 'info'; icon: 'ok' | 'pen' | 'clock' }> = {
  published: { tone: 'success', icon: 'ok' },
  draft: { tone: 'neutral', icon: 'pen' },
  scheduled: { tone: 'info', icon: 'clock' },
}

export interface ContentTabProps {
  kind: ContentKind
  api: StorefrontApi
  /** Opens the studio on one of the AI's pages; null when this seat has no studio (a reader, or no site yet). */
  onStudio: ((path: string) => void) | null
}

/** Storefront › Pages (StorefrontContent; FIRST-RELEASE §14): content pages and the AI's own pages, newest edit first. */
export const ContentTab = ({ kind, api, onStudio }: ContentTabProps) => {
  const [list, setList] = useState<List>({ kind: 'loading' })
  const latest = useRef(0)
  const load = useCallback(() => {
    const ask = ++latest.current
    setList({ kind: 'loading' })
    void Promise.all([api.loadContentList(kind, null), kind === 'page' ? api.loadCustomPaths() : Promise.resolve([])]).then(
      ([page, custom]) => ask === latest.current && setList({ kind: 'ready', rows: page.rows, custom, next: page.next, more: 'idle' }),
      () => ask === latest.current && setList({ kind: 'error' }),
    )
  }, [api, kind])
  useEffect(load, [load])

  const more = () => {
    if (list.kind !== 'ready' || !list.next) return
    const ask = latest.current
    setList({ ...list, more: 'loading' })
    api.loadContentList(kind, list.next).then(
      (page) => ask === latest.current && setList((was) => (was.kind === 'ready' ? { ...was, rows: [...was.rows, ...page.rows], next: page.next, more: 'idle' } : was)),
      () => ask === latest.current && setList((was) => (was.kind === 'ready' ? { ...was, more: 'failed' } : was)),
    )
  }

  const w = words.pages
  const metaOf = (r: ContentRow) => {
    const edited = fill(w.edited, { date: formatTime(r.updatedAt) })
    return r.inMenu ? fill(w.inMenu, { meta: edited }) : edited
  }
  if (list.kind === 'loading') return <LoadingState label={words.loading} />
  if (list.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />

  const empty = list.rows.length === 0 && list.custom.length === 0
  return (
    <div className="df-sfc">
      <div className="df-sfc-head">
        <div>
          <h2>{w.title}</h2>
          <p>{w.sub}</p>
        </div>
      </div>
      {empty ? (
        <p className="df-sfc-empty">{w.empty}</p>
      ) : (
        <ul className="df-sfc-rows">
          {list.rows.map((r) => (
            <li key={r.id}>
              <div className="df-sfc-row">
                <span className="df-sfc-name">
                  <strong>{r.title}</strong>
                  <span className="df-sfc-path">{r.path}</span>
                </span>
                <StatusPill tone={pills[r.status].tone} icon={pills[r.status].icon} label={words.status[r.status]} />
                <span className="df-sfc-meta">{metaOf(r)}</span>
              </div>
            </li>
          ))}
          {list.custom.map((path) => {
            const inside = (
              <>
                <span className="df-sfc-name">
                  <strong className="df-sfc-path">{path}</strong>
                </span>
                <span className="df-sf-tag">{w.ai}</span>
                <span className="df-sfc-meta">{onStudio ? w.aiMeta : ''}</span>
              </>
            )
            return (
              <li key={path}>
                {onStudio ? (
                  <button type="button" className="df-sfc-row" aria-label={fill(w.aiOpen, { path })} onClick={() => onStudio(path)}>
                    {inside}
                  </button>
                ) : (
                  <div className="df-sfc-row">{inside}</div>
                )}
              </li>
            )
          })}
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
