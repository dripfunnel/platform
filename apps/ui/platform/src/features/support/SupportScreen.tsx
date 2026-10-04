import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, reserveTab, useNow, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { endSupportSession, loadSupportSessions, loadSupportTargets, returnToSupportSession, type Page, type SupportSession, type SupportTarget } from '../../api/support'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { SessionsTab } from './SessionsTab'
import { Support, SupportError, SupportLoading, SupportRefused } from './Support'
import { supportStates } from './supportHarness'
import { refusalText } from './supportText'
import { useStartSupport } from './useStartSupport'
import { UsersTab } from './UsersTab'

const supportRoute = getRouteApi('/_app/support')
const shellRoute = getRouteApi('/_app')
const words = messages.support

type MoreState = 'idle' | 'busy' | 'failed'

// A first page from the loader or a search, grown by Show more; a page still on its way when the
// first one changes is dropped.
const usePaged = <T,>(first: Page<T> | null, load: (after: string) => Promise<Page<T>>) => {
  const [pages, setPages] = useState<{ items: readonly T[]; endCursor: string | null; more: boolean } | null>(null)
  const [state, setState] = useState<MoreState>('idle')
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

export const SupportScreen = () => {
  const data = supportRoute.useLoaderData()
  const { tab = 'users' } = supportRoute.useSearch()
  const { me, badges } = shellRoute.useLoaderData()
  const forced = useScreenState(supportStates, harnessEnabled)
  const router = useRouter()
  const now = useNow(30_000)
  const [search, setSearch] = useState<string | undefined>(undefined)
  const [found, setFound] = useState<Page<SupportTarget> | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)
  const [ending, setEnding] = useState<SupportSession | null>(null)
  const start = useStartSupport(me)
  const setToast = start.say

  const loaded = data.refused ? null : data
  const reload = useCallback(() => void router.invalidate(), [router])

  // A search reads its own first page; clearing it goes back to the loader's.
  useEffect(() => {
    setSearchFailed(false)
    if (!search) return setFound(null)
    let live = true
    loadSupportTargets(search, {}).then(
      (page) => live && setFound(page),
      () => live && setSearchFailed(true),
    )
    return () => {
      live = false
    }
  }, [search, loaded])

  const users = usePaged(search ? found : (loaded?.users ?? null), (after) => loadSupportTargets(search, { after }))
  const history = usePaged(loaded?.history ?? null, (after) => loadSupportSessions(false, { after }))

  if (forced === 'loading') return <SupportLoading />
  if (forced === 'error') return <SupportError onRetry={reload} />
  if (forced === 'denied' || !loaded) return <SupportRefused reason={fill(words.denied, { role: messages.shell.roles[forced === 'denied' ? 'partner-finance' : me.role] })} />

  const mine = loaded.open.items.find((session) => session.you) ?? null

  const returnTo = (session: SupportSession) => {
    const tab = reserveTab()
    returnToSupportSession(session.id)
      .then((result) => {
        if (!result.ok) {
          tab.close()
          reload()
          return setToast(refusalText(result.reason))
        }
        tab.go(result.link)
        if (tab.blocked) setToast(words.toasts.popupBlocked)
      })
      .catch(() => {
        tab.close()
        setToast(words.toasts.failed)
      })
  }

  const end = (session: SupportSession) => {
    setEnding(null)
    endSupportSession(session.id)
      .then((result) => setToast(result.ok ? fill(words.toasts.ended, { name: session.user.name }) : refusalText(result.reason)))
      .catch(() => setToast(words.toasts.failed))
      .finally(reload)
  }

  return (
    <>
      <Support tab={tab} openCount={badges.supportOpenSessions}>
        {tab === 'users' && (
          <UsersTab
            users={users.items}
            search={search}
            partner={me.partner.name}
            me={me.name}
            more={{ ...users.more, failed: users.more.failed || searchFailed }}
            onSearch={setSearch}
            onMore={users.onMore}
            onOpen={(target) => start.open(target, mine)}
          />
        )}
        {tab === 'sessions' && <SessionsTab open={loaded.open.items} history={history.items} now={now} more={history.more} onReturn={returnTo} onEnd={setEnding} onMore={history.onMore} />}
      </Support>
      {start.element}
      {ending && (
        <ConfirmDialog
          open
          danger
          title={fill(words.endConfirm.title, { user: ending.user.name })}
          target={ending.store.name}
          consequence={fill(words.endConfirm.body, { store: ending.store.name, agent: ending.you ? words.you : ending.agent.name })}
          confirmLabel={words.endConfirm.confirm}
          cancelLabel={words.endConfirm.cancel}
          onConfirm={() => end(ending)}
          onCancel={() => setEnding(null)}
        />
      )}
    </>
  )
}

// A DripFunnel staff session is refused by the API (ACCESS.md §8.2); anything else is an error.
export const SupportRouteError = ({ error }: ErrorComponentProps) => {
  const router = useRouter()
  const { me } = shellRoute.useLoaderData()
  if (isApiError(error, 'BLOCKED_WHILE_IMPERSONATING') || isApiError(error, 'PARTNER_ENTERS_THIS_ITSELF')) return <SupportRefused reason={fill(words.staffBlocked, { partner: me.partner.name })} />
  return <SupportError onRetry={() => void router.invalidate()} />
}
