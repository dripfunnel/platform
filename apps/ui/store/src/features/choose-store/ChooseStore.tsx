import { ErrorState, Icon, initials, LoadingState, safeNext } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { actingStore } from '../../acting'
import { shellSample } from '../../api/sample'
import { loadMe, loadMyStores, openStore, signOut, type Me, type StoreChoice } from '../../api/shell'
import { fill, formatCount, messages, plural } from '../../messages'
import { AuthFrame } from '../auth/AuthFrame'
import { Foot } from '../auth/fields'
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
        await navigate({ to: '/sign-in' })
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
  if (view.kind === 'loading') return <AuthFrame panel="in" title={words.title}><LoadingState label={words.loading} /></AuthFrame>
  if (view.kind === 'error') return <AuthFrame panel="in" title={words.error.title}><ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => void load() }} /></AuthFrame>
  if (view.kind === 'none')
    return (
      <AuthFrame panel="in" title={words.none.title} sub={words.none.body} icon={{ name: 'alert', tone: 'warning' }}>
        <Foot text={words.notYou} link={words.none.signOut} onClick={leave} />
      </AuthFrame>
    )
  return (
    <AuthFrame panel="in" title={words.title} sub={fill(words.body, { email: view.me.email, count: fill(plural(words.stores, view.stores.length), { count: formatCount(view.stores.length) }) })}>
      <ul className="df-store-choices">
        {view.stores.map((choice, index) => {
          const isLast = last?.storeId === choice.store.id && (last.supplierId ?? null) === (choice.seller?.id ?? null)
          const tone = choice.seller ? 'supplier' : index === 0 ? 'first' : 'other'
          return (
            <li key={choice.membershipId}>
              <button type="button" className={`df-store-choice${isLast ? ' df-store-choice--last' : ''}`} disabled={opening !== null} aria-busy={opening === choice.membershipId} onClick={() => void open(choice)}>
                <span className={`df-store-choice-mark df-store-choice-mark--${tone}`} aria-hidden="true">
                  {initials(choice.store.name).slice(0, 1)}
                </span>
                <span className="df-store-choice-text">
                  <strong>{choice.store.name}</strong>
                  <small>{choiceLabel(choice)}</small>
                </span>
                {isLast && <span className="df-store-choice-last">{messages.auth.chooser.lastUsed}</span>}
                <span className="df-store-choice-go" aria-hidden="true">
                  <Icon name="chevron" size={18} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <Foot text={words.notYou} link={words.signOut} onClick={leave} />
    </AuthFrame>
  )
}
