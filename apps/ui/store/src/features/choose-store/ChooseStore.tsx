import { Button, ErrorState, initials, LoadingState, safeNext } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/auth.css'
import '@dripfunnel/shared/ui/shell.css'
import '@dripfunnel/shared/ui/states.css'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { actingStore } from '../../acting'
import { shellSample } from '../../api/sample'
import { loadMe, loadMyStores, openStore, signOut, type Me, type StoreChoice } from '../../api/shell'
import { fill, formatCount, messages, plural } from '../../messages'
import { EnvironmentStrip } from '../shell/EnvironmentStrip'
import { choiceLabel } from '../shell/StoreSwitcher'
import './chooseStore.css'

const words = messages.chooseStore

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'none'; me: Me } | { kind: 'pick'; me: Me; stores: StoreChoice[] }

/** None is refused, one goes straight in, several are listed: the portal never picks between them. */
export const chooserStep = (stores: readonly StoreChoice[]): { kind: 'none' } | { kind: 'open'; choice: StoreChoice } | { kind: 'pick' } => {
  const [only] = stores
  if (!only) return { kind: 'none' }
  return stores.length === 1 ? { kind: 'open', choice: only } : { kind: 'pick' }
}

/** Where an opened store lands: the page that sent the person here, on this host only, else Home. */
export const chooserDestination = (next: unknown, origin: string): string => safeNext(next, origin, '/home')

/** Signed out on the chooser: sign-in comes back here with the same landing, as loadShell's redirect does. */
export const signInSearch = (next: unknown, origin: string): { next: string } => ({ next: chooserDestination(next, origin) })

// FIRST-RELEASE.md §4 "Choose a store": the portal never picks between several; one goes straight in,
// none is refused rather than shown an empty portal. The last store is a convenience (ACCESS.md §4).
export const ChooseStore = ({ next, as }: { next: string | undefined; as?: string | undefined }) => {
  const navigate = useNavigate()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [opening, setOpening] = useState<string | null>(null)
  // The harness's chooser (`?as=`): the sample's stores, no API (ui/README.md §6).
  const sample = useMemo(() => shellSample({ as }), [as])

  const open = useCallback(
    async (choice: StoreChoice) => {
      setOpening(choice.membershipId)
      if (sample) {
        await navigate({ to: '/home', search: { as } })
        return
      }
      try {
        await openStore(choice)
        await navigate({ href: chooserDestination(next, window.location.origin) })
      } catch {
        setOpening(null)
        setView({ kind: 'error' })
      }
    },
    [navigate, next, sample, as],
  )

  const load = useCallback(async () => {
    setView({ kind: 'loading' })
    if (sample) {
      setView({ kind: 'pick', me: sample.me, stores: sample.stores })
      return
    }
    try {
      const me = await loadMe()
      if (!me) {
        await navigate({ to: '/sign-in', search: signInSearch(next, window.location.origin) })
        return
      }
      const stores = await loadMyStores()
      const step = chooserStep(stores)
      if (step.kind === 'none') setView({ kind: 'none', me })
      else if (step.kind === 'open') await open(step.choice)
      else setView({ kind: 'pick', me, stores })
    } catch {
      setView({ kind: 'error' })
    }
  }, [navigate, open, sample])

  useEffect(() => {
    void load()
  }, [load])

  const leave = () => signOut()

  const last = actingStore()
  return (
    <div className="df-auth">
      <div className="df-banners">
        <EnvironmentStrip />
      </div>
      <main className="df-sign-in">
        {view.kind === 'loading' && <LoadingState label={words.loading} />}
        {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => void load() }} />}
        {view.kind === 'none' && (
          <section className="df-sign-in-card">
            <h1>{words.none.title}</h1>
            <p>{words.none.body}</p>
            <Button onClick={leave}>{words.none.signOut}</Button>
          </section>
        )}
        {view.kind === 'pick' && (
          <section className="df-sign-in-card">
            <h1>{words.title}</h1>
            <p>{fill(words.body, { email: view.me.email, count: fill(plural(words.stores, view.stores.length), { count: formatCount(view.stores.length) }) })}</p>
            <ul className="df-store-choices">
              {view.stores.map((choice) => {
                const isLast = last?.storeId === choice.store.id && (last.supplierId ?? null) === (choice.seller?.id ?? null)
                return (
                  <li key={choice.membershipId}>
                    <button type="button" className={`df-store-choice${isLast ? ' df-store-choice--last' : ''}`} disabled={opening !== null} aria-busy={opening === choice.membershipId} onClick={() => void open(choice)}>
                      <span className={`df-store-choice-mark${choice.seller ? ' df-store-choice-mark--supplier' : ''}`} aria-hidden="true">
                        {initials(choice.store.name).slice(0, 1)}
                      </span>
                      <span className="df-store-choice-text">
                        <strong>{choice.store.name}</strong>
                        <small>{choiceLabel(choice)}</small>
                      </span>
                      {isLast && <span className="df-store-choice-last">{words.last}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="df-sign-in-footer">
              {words.notYou}{' '}
              <button type="button" className="df-sign-in-link" onClick={leave}>
                {words.signOut}
              </button>
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
