import { useEffect, useState } from 'react'
import { previewCollection, searchPickable, type Pickable, type Preview, type RuleInput } from '../../api/collections'
import type { ApiClient } from '../../graphql'

export type Read<T> = { status: 'idle' } | { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: T }

const pauseMs = 300

/** Runs `read` a moment after `key` stops changing; an answer to an earlier key is dropped. Nothing is read while `enabled` is false. */
function useDebounced<T>(enabled: boolean, key: string, read: () => Promise<T>): Read<T> {
  const [view, setView] = useState<Read<T>>({ status: 'idle' })
  useEffect(() => {
    if (!enabled) return setView({ status: 'idle' })
    let live = true
    setView({ status: 'loading' })
    const timer = setTimeout(
      () =>
        void read().then(
          (data) => live && setView({ status: 'ready', data }),
          () => live && setView({ status: 'failed' }),
        ),
      pauseMs,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `key` stands for what `read` closes over, which is rebuilt on every render.
  }, [enabled, key])
  return view
}

type PreviewInput = { match: 'all' | 'any'; rules: RuleInput[]; parentId: string | null; inheritParent: boolean }

/** The API's count and first products for rules not saved yet (CATALOG-DESIGN.md H4): the app never matches products itself. */
export const useCollectionPreview = (client: ApiClient, enabled: boolean, draft: PreviewInput): Read<Preview> =>
  useDebounced(enabled, JSON.stringify(draft), () => previewCollection(client, draft))

/** "Search products to add": the API's first thirty by name for what is typed. */
export const usePickable = (client: ApiClient, enabled: boolean, query: string): Read<Pickable[]> => useDebounced(enabled, query.trim(), () => searchPickable(client, query))

/** The names of products seen in a search or a preview, so a pick can be shown by name after the search changes. */
export const useNames = (initial: readonly { id: string; name: string }[]): [Record<string, string>, (seen: readonly { id: string; name: string }[]) => void] => {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((p) => [p.id, p.name])))
  return [names, (seen) => setNames((known) => ({ ...known, ...Object.fromEntries(seen.map((p) => [p.id, p.name])) }))]
}
