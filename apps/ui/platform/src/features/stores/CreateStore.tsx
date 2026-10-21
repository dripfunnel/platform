// States (?state=): loading, error, readonly, denied. The form's options and the permission are the API's.
import { ErrorState, ListHeader, LoadingState, PermissionDenied, ReadOnlyNotice, usePolling } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import { Link } from '@tanstack/react-router'
import { useId, useState, type FormEvent } from 'react'
import type { Me } from '../../api/me'
import { createStoreInput, type CreateRefusal, type CreateStoreForm, type CreateStoreInput, type CreateStoreResult, type ProvisioningProgress } from '../../api/stores'
import { fill, formatAmount, formatCount, messages } from '../../messages'
import { ProvisioningPanel } from './ProvisioningPanel'
import type { CreateState } from './storeHarness'
import './stores.css'
import { chargedByOf } from './storeLook'

const words = messages.stores.new

export interface CreateStoreProps {
  me: Me
  form: CreateStoreForm
  forced: CreateState | null
  onCreate: (input: CreateStoreInput) => Promise<CreateStoreResult>
  progressOf: (storeId: string) => Promise<ProvisioningProgress>
}

const Header = ({ host }: { host: string }) => <ListHeader title={words.title} sub={fill(words.lede, { host })} />

export const CreateStoreLoading = ({ host }: { host: string }) => (
  <div className="df-page df-list df-create">
    <Header host={host} />
    <LoadingState label={words.loading} rows={5} />
  </div>
)

export const CreateStoreError = ({ host, onRetry }: { host: string; onRetry: () => void }) => (
  <div className="df-page df-list df-create">
    <Header host={host} />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

interface Fields {
  name: string
  ownerName: string
  ownerEmail: string
  country: string
  planId: string
  trialDays: string
}

// Polls the signup job every half second until it is done, then stops.
const useProvisioning = (storeId: string | null, progressOf: CreateStoreProps['progressOf']) => {
  const [finishedId, setFinishedId] = useState<string | null>(null)
  const { value } = usePolling(
    storeId && finishedId !== storeId
      ? () =>
          progressOf(storeId).then((progress) => {
            if (progress.done) setFinishedId(storeId)
            return { storeId, progress }
          })
      : null,
    500,
  )
  return value?.storeId === storeId ? value.progress : null
}

// The plan's own trial when the form offers that length, else the form's first (§6.2, §7.2).
const trialFor = (form: CreateStoreForm, planId: string): string => {
  const own = form.plans.find((plan) => plan.id === planId)?.trialDays
  return String(own !== undefined && form.trials.includes(own) ? own : (form.trials[0] ?? 0))
}

// The refusals about the input itself; the others are the permission's (FIRST-RELEASE §6.2).
const formRefusals: readonly CreateRefusal[] = ['INVALID_INPUT', 'UNPRICED_CURRENCY', 'PLAN_NOT_LIVE']

export const CreateStore = ({ me, form, forced, onCreate, progressOf }: CreateStoreProps) => {
  const ids = { name: useId(), owner: useId(), email: useId(), country: useId(), plan: useId(), trial: useId(), error: useId() }
  const initial: Fields = {
    name: '',
    ownerName: '',
    ownerEmail: '',
    country: form.countries[0]?.code ?? '',
    planId: form.plans[0]?.id ?? '',
    trialDays: trialFor(form, form.plans[0]?.id ?? ''),
  }
  const [fields, setFields] = useState(initial)
  const [invalid, setInvalid] = useState(false)
  // A refusal about what was typed or picked: worded by the form, which stays usable.
  const [formRefusal, setFormRefusal] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [refused, setRefused] = useState<Exclude<CreateStoreResult, { ok: true }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ storeId: string; name: string; owner: string } | null>(null)
  const progress = useProvisioning(created?.storeId ?? null, progressOf)
  // Creating a store needs Live, and a Live partner has its portal host (FIRST-RELEASE §4).
  const host = me.partner.host ?? ''

  if (forced === 'loading') return <CreateStoreLoading host={host} />
  if (forced === 'error') return <CreateStoreError host={host} onRetry={() => undefined} />

  const set = (patch: Partial<Fields>) => {
    setFormRefusal(null)
    setFields((current) => ({ ...current, ...patch }))
  }
  const plan = form.plans.find((candidate) => candidate.id === fields.planId)
  const currency = form.countries.find((candidate) => candidate.code === fields.country)?.currency
  const price = plan && currency ? plan.price[currency] : undefined
  const priceLine = price
    ? fill(words.price, { price: formatAmount(price), who: chargedByOf(form.billingMode, me.partner.name) }) + (fields.trialDays === '0' ? words.fromToday : fill(words.afterTrial, { days: fields.trialDays }))
    : null
  const permission = refused ? { allowed: false as const, reason: refused.reason } : form.permission

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = createStoreInput.safeParse({ ...fields, trialDays: Number(fields.trialDays) })
    if (!parsed.success) return setInvalid(true)
    setInvalid(false)
    setFailed(false)
    setBusy(true)
    onCreate(parsed.data).then(
      (result) => {
        setBusy(false)
        if (result.ok) setCreated({ storeId: result.storeId, name: parsed.data.name, owner: parsed.data.ownerName })
        else if (formRefusals.includes(result.reason)) setFormRefusal(messages.stores.refused[result.reason])
        else setRefused(result)
      },
      () => {
        setBusy(false)
        setFailed(true)
      },
    )
  }

  return (
    <div className="df-page df-list df-create">
      <nav aria-label={words.breadcrumb} className="df-breadcrumbs">
        <Link to="/stores">{messages.screens.stores.title}</Link>
      </nav>
      <Header host={host} />
      {(me.role === 'partner-read-only' || forced === 'readonly') && <ReadOnlyNotice title={messages.states.readonly.title} body={messages.states.readonly.body} />}
      {created ? (
        <ProvisioningPanel
          storeId={created.storeId}
          storeName={created.name}
          ownerName={created.owner}
          progress={progress}
          onAgain={() => {
            setCreated(null)
            setFields({ ...initial, planId: fields.planId, country: fields.country })
          }}
        />
      ) : (
        <form className="df-create-form" onSubmit={submit} noValidate aria-describedby={invalid || failed || formRefusal ? ids.error : undefined}>
          {(invalid || failed || formRefusal) && (
            <p id={ids.error} role="alert" className="df-create-error">
              {formRefusal ?? (invalid ? words.invalid : words.failed)}
            </p>
          )}
          <div className="df-field">
            <label htmlFor={ids.name}>{words.fields.name}</label>
            <input id={ids.name} type="text" value={fields.name} placeholder={words.fields.namePlaceholder} maxLength={80} onChange={(event) => set({ name: event.target.value })} />
          </div>
          <div className="df-create-row">
            <div className="df-field">
              <label htmlFor={ids.owner}>{words.fields.owner}</label>
              <input id={ids.owner} type="text" autoComplete="off" value={fields.ownerName} maxLength={80} onChange={(event) => set({ ownerName: event.target.value })} />
            </div>
            <div className="df-field">
              <label htmlFor={ids.email}>{words.fields.email}</label>
              <input id={ids.email} type="email" autoComplete="off" value={fields.ownerEmail} maxLength={254} onChange={(event) => set({ ownerEmail: event.target.value })} />
            </div>
          </div>
          <div className="df-create-row df-create-row--three">
            <div className="df-field">
              <label htmlFor={ids.country}>{words.fields.country}</label>
              <select id={ids.country} value={fields.country} onChange={(event) => set({ country: event.target.value })}>
                {form.countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="df-field">
              <label htmlFor={ids.plan}>{words.fields.plan}</label>
              <select id={ids.plan} value={fields.planId} onChange={(event) => set({ planId: event.target.value, trialDays: trialFor(form, event.target.value) })}>
                {form.plans.map((option) => {
                  const optionPrice = currency ? option.price[currency] : undefined
                  return (
                    <option key={option.id} value={option.id}>
                      {optionPrice ? fill(words.planOption, { plan: option.name, price: formatAmount(optionPrice) }) : option.name}
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="df-field">
              <label htmlFor={ids.trial}>{words.fields.trial}</label>
              <select id={ids.trial} value={fields.trialDays} onChange={(event) => set({ trialDays: event.target.value })}>
                {form.trials.map((days) => (
                  <option key={days} value={String(days)}>
                    {days === 0 ? words.trials.none : fill(words.trials.days, { count: formatCount(days) })}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {priceLine && <p className="df-create-price">{priceLine}</p>}
          <p className="df-create-note">{words.invitation}</p>
          <div className="df-create-submit">
            {permission.allowed ? (
              <button type="submit" className="df-button df-button--primary" disabled={busy}>
                {words.submit}
              </button>
            ) : (
              <PermissionDenied actionLabel={words.submit} reason={fill(messages.stores.refused[permission.reason], { product: me.partner.product })} />
            )}
          </div>
        </form>
      )}
    </div>
  )
}
