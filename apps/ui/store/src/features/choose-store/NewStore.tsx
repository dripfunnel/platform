import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { rememberActing } from '../../acting'
import { currentBrand } from '../../brand/current'
import { createAnotherStore, isRefusal, newStoreOptions, type AuthRefusal, type Country } from '../../api/auth'
import { fill, formatCount, messages } from '../../messages'
import { AuthFrame } from '../auth/AuthFrame'
import { Primary } from '../auth/fields'
import { signupText } from '../auth/refusals'
import { draftSubdomain, emptyStoreDraft, StoreFields, storeDraftProblem } from '../auth/StoreFields'

const words = messages.chooseStore
const su = messages.auth.signup

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'refused'; text: string } | { kind: 'store'; countries: Country[]; shopDomain: string | null } | { kind: 'building'; storeId: string; enrol: boolean }

/** Past a person's stores, support opens the next one: the partner's own contact, as the sign-in footer shows it. */
const limitText = (limit: number): string => {
  const brand = currentBrand()
  const support = brand?.supportEmail ?? brand?.supportUrl ?? null
  const count = formatCount(limit)
  return support ? fill(words.create.limit, { limit: count, support }) : fill(words.create.limitNoContact, { limit: count })
}

const refusedText = (refusal: AuthRefusal): string => {
  if (refusal.code === 'FORBIDDEN') return words.create.forbidden
  if (refusal.code === 'STORE_LIMIT' && refusal.limit !== undefined) return limitText(refusal.limit)
  return signupText(refusal)
}

// "Create another store" (FIRST-RELEASE §4; PortalAuth `pick` → su3, then the building view; #1136): a
// signed-in person's next store, with no account step and no texted code, opened as the acting store.
export const NewStore = () => {
  const navigate = useNavigate()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [draft, setDraft] = useState(emptyStoreDraft)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toSignIn = useCallback(() => void navigate({ to: '/sign-in', search: { next: '/stores/new' } }), [navigate])
  const back = () => void navigate({ to: '/stores' })

  const load = useCallback(async () => {
    setView({ kind: 'loading' })
    const answer = await newStoreOptions()
    if (!isRefusal(answer)) {
      setDraft((d) => ({ ...d, country: d.country || (answer.countries[0]?.code ?? '') }))
      return setView({ kind: 'store', countries: answer.countries, shopDomain: answer.shopDomain })
    }
    if (answer.code === 'INVALID_CREDENTIALS') return toSignIn()
    setView(answer.code === 'NOT_CONNECTED' ? { kind: 'error' } : { kind: 'refused', text: refusedText(answer) })
  }, [toSignIn])

  useEffect(() => {
    void load()
  }, [load])

  // The building view stays up a moment; an Owner without two-step sign-in sets it up first (ACCESS.md §4).
  useEffect(() => {
    if (view.kind !== 'building') return
    rememberActing({ storeId: view.storeId, supplierId: null })
    const leave = setTimeout(() => void (view.enrol ? navigate({ to: '/sign-in', search: { step: 'enrol', next: '/home' } }) : navigate({ to: '/home' })), 1200)
    return () => clearTimeout(leave)
  }, [view, navigate])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = storeDraftProblem(draft)
    if (problem) return setError(problem)
    setBusy(true)
    void (async () => {
      try {
        const answer = await createAnotherStore(draft.store.trim(), draftSubdomain(draft), draft.country)
        if (!isRefusal(answer)) return setView({ kind: 'building', storeId: answer.storeId, enrol: answer.step === 'enrol' })
        if (answer.code === 'INVALID_CREDENTIALS') return toSignIn()
        setError(refusedText(answer))
      } finally {
        setBusy(false)
      }
    })()
  }

  const backLink = { label: words.create.back, onBack: back }
  switch (view.kind) {
    case 'loading':
      return (
        <AuthFrame panel="up" title={su.su3.title} back={backLink}>
          <LoadingState label={words.create.loading} />
        </AuthFrame>
      )
    case 'error':
      return (
        <AuthFrame panel="up" title={words.error.title} back={backLink}>
          <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => void load() }} />
        </AuthFrame>
      )
    case 'refused':
      return <AuthFrame panel="up" title={su.su3.title} back={backLink} icon={{ name: 'alert', tone: 'warning' }} notice={{ text: view.text, tone: 'error' }} />
    case 'store':
      return (
        <AuthFrame panel="up" title={su.su3.title} sub={su.su3.sub} back={backLink} notice={error ? { text: error, tone: 'error' } : null}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <StoreFields draft={draft} onDraft={setDraft} countries={view.countries} shopDomain={view.shopDomain} />
            <Primary busy={busy}>{words.create.primary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'building':
      return <AuthFrame panel="up" step="building" icon={{ name: 'spark', tone: 'warning' }} title={fill(su.building.title, { store: draft.store.trim() || su.building.yourStore })} sub={su.building.sub} />
  }
}
