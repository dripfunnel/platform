import { useEffect, useRef, useState } from 'react'
import type { Page } from '../../api/page'

export interface More {
  show: boolean
  busy: boolean
  failed: boolean
}

/** A first page from a loader, grown by Show more; a page on its way when the first one changes is dropped. */
export const usePaged = <T,>(first: Page<T> | null, load: (after: string) => Promise<Page<T>>): { items: readonly T[]; more: More; onMore: () => void } => {
  const [pages, setPages] = useState<{ items: readonly T[]; endCursor: string | null; more: boolean } | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const current = useRef(first)
  useEffect(() => {
    current.current = first
    setPages(null)
    setState('idle')
  }, [first])
  const shown = pages ?? { items: first?.items ?? [], endCursor: first?.pageInfo.endCursor ?? null, more: first?.pageInfo.hasNextPage ?? false }
  const onMore = () => {
    if (!shown.endCursor) return
    const asked = first
    setState('busy')
    load(shown.endCursor).then(
      (next) => {
        if (current.current !== asked) return
        setPages({ items: [...shown.items, ...next.items], endCursor: next.pageInfo.endCursor, more: next.pageInfo.hasNextPage })
        setState('idle')
      },
      () => current.current === asked && setState('failed'),
    )
  }
  return { items: shown.items, more: { show: shown.more, busy: state === 'busy', failed: state === 'failed' }, onMore }
}

export const ShowMore = ({ more, onMore, label, failed }: { more: More; onMore: () => void; label: string; failed: string }) => (
  <>
    {more.failed && <p role="alert">{failed}</p>}
    {more.show && (
      <div className="df-show-more">
        <button type="button" className="df-button" disabled={more.busy} onClick={onMore}>
          {label}
        </button>
      </div>
    )}
  </>
)
