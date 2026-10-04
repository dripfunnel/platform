import { ErrorState, Icon, ListHeader, LoadingState, PermissionDenied, StatusPill } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import { Link } from '@tanstack/react-router'
import { useId, type FormEvent } from 'react'
import type { Address, DomainKind } from '../../api/domains'
import { fill, messages, plural } from '../../messages'
import { exampleFor, helpText, isWildcard } from './addDomainRules'
import { statusPill } from './domainLook'
import { RecordTable } from './RecordTable'
import './domains.css'

const words = messages.domains.new
const kinds = messages.domains.kinds

const Header = () => (
  <>
    <nav aria-label={words.breadcrumb} className="df-breadcrumbs">
      <Link to="/domains">{messages.screens.domains.title}</Link>
    </nav>
    <ListHeader title={words.title} sub={words.lede} />
  </>
)

export const AddDomainLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={messages.domains.loading} rows={3} />
  </div>
)

export const AddDomainError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={messages.domains.error.title} body={messages.domains.error.body} retry={{ label: messages.domains.error.retry, onRetry }} />
  </div>
)

export const AllAddressesSet = () => (
  <div className="df-page df-list">
    <nav aria-label={words.breadcrumb} className="df-breadcrumbs">
      <Link to="/domains">{messages.screens.domains.title}</Link>
    </nav>
    <ListHeader title={words.allSet.title} sub={words.allSet.body} />
    <div>
      <Link to="/domains" className="df-button">
        {words.allSet.back}
      </Link>
    </div>
  </div>
)

export const AddDomainDenied = () => (
  <div className="df-page df-list">
    <Header />
    <PermissionDenied actionLabel={messages.domains.add} reason={messages.domains.addRefused} />
  </div>
)

export type Step = 1 | 2 | 3

const Steps = ({ step }: { step: Step }) => (
  <ol className="df-add-steps" aria-label={words.stepsLabel}>
    {([words.steps.address, words.steps.records, words.steps.check] as const).map((label, index) => {
      const n = index + 1
      return (
        <li key={label} aria-current={n === step ? 'step' : undefined} className={n < step ? 'df-add-step--done' : undefined}>
          <span className="df-add-step-n">{n < step ? (
              <>
                <Icon name="ok" size={12} strokeWidth={2.6} />
                <span className="df-visually-hidden">{words.stepDone}</span>
              </>
            ) : (
              n
            )}</span>
          {label}
        </li>
      )
    })}
  </ol>
)

export interface AddressStepProps {
  addresses: readonly Address[]
  zone: string | null
  kind: DomainKind
  typed: string
  error: string | null
  busy: boolean
  onKind: (kind: DomainKind) => void
  onType: (typed: string) => void
  onContinue: () => void
}

// Step 1 (§9.2): what the address is for, the added ones marked, and the hostname.
export const AddressStep = ({ addresses, zone, kind, typed, error, busy, onKind, onType, onContinue }: AddressStepProps) => {
  const fieldId = useId()
  const errorId = useId()
  const helpId = useId()
  const example = exampleFor(kind, zone)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onContinue()
  }
  return (
    <form className="df-panel df-add" onSubmit={submit} noValidate>
      <fieldset className="df-add-kinds">
        <legend>{words.kindQuestion}</legend>
        {addresses.map((address) => (
          <label key={address.kind} className="df-add-kind">
            <input type="radio" name="kind" value={address.kind} checked={address.kind === kind} disabled={address.added} onChange={() => onKind(address.kind)} />
            <span className="df-stack">
              <span>
                <strong>{kinds[address.kind].label}</strong>
                {address.added && <span className="df-add-added">{words.added}</span>}
              </span>
              <span className="df-muted">{kinds[address.kind].pick}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="df-field">
        <label htmlFor={fieldId}>{isWildcard(kind) ? words.wildcardField : words.field}</label>
        <span className="df-add-host">
          {isWildcard(kind) && <span aria-hidden="true">*.</span>}
          <input
            id={fieldId}
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            placeholder={example}
            maxLength={253}
            aria-invalid={error !== null}
            aria-describedby={error ? `${errorId} ${helpId}` : helpId}
            onChange={(event) => onType(event.target.value)}
          />
        </span>
        {error && (
          <span id={errorId} role="alert" className="df-field-error">
            {error}
          </span>
        )}
        <span id={helpId} className="df-muted">
          {helpText(kind, example)}
        </span>
      </div>
      <div className="df-add-actions">
        <Link to="/domains">{words.cancel}</Link>
        <button type="submit" className="df-button df-button--primary" disabled={busy}>
          {busy ? words.adding : words.continue}
        </button>
      </div>
    </form>
  )
}

export interface RecordsStepProps {
  address: Extract<Address, { added: true }>
  apex: boolean
  busy: boolean
  onCopy: (text: string) => void
  onCheck: () => void
}

// Step 2: the records the API made for the address, to add at the DNS provider.
export const RecordsStep = ({ address, apex, busy, onCopy, onCheck }: RecordsStepProps) => {
  const count = address.records.length
  return (
    <section className="df-panel df-add" aria-labelledby="add-records">
      <div className="df-stack">
        <h2 id="add-records">{fill(plural(words.recordsTitle, count), { count: String(count) })}</h2>
        <p>{fill(words.recordsLede, { apex: address.zone })}</p>
      </div>
      <RecordTable host={address.host} kind={address.kind} records={address.records} showFound={false} onCopy={onCopy} />
      {apex && <p className="df-add-warning">{fill(words.apexWarning, { host: address.host })}</p>}
      <p className="df-muted">{words.providerNote}</p>
      <div className="df-add-actions">
        <span />
        <button type="button" className="df-button df-button--primary" disabled={busy} onClick={onCheck}>
          {plural(words.checkNow, count)}
        </button>
      </div>
    </section>
  )
}

export interface CheckStepProps {
  address: Extract<Address, { added: true }>
  more: boolean
  note: string | null
  busy: boolean
  onCheck: () => void
  onNext: () => void
}

// What step 3 says, by the address's status as the API last read it (§9.2).
const outcomeOf = (address: Extract<Address, { added: true }>): string => {
  const count = address.records.length
  if (address.status === 'live' || address.status === 'expiring') return plural(words.live[address.kind], count)
  if (address.status === 'verifying' || address.status === 'issuing') return plural(words.found, count)
  if (address.status === 'failed' || address.status === 'broken') return plural(words.mismatch, count)
  return plural(words.waiting, count)
}

// Step 3: found and live, or saved and waiting; the regular check carries on either way.
export const CheckStep = ({ address, more, note, busy, onCheck, onNext }: CheckStepProps) => {
  const live = address.status === 'live' || address.status === 'expiring'
  return (
    <section className="df-panel df-add" role="status" aria-live="polite">
      <StatusPill {...statusPill(address.status)} />
      <h2>{address.host}</h2>
      <p>{outcomeOf(address)}</p>
      {note && <p className="df-muted">{note}</p>}
      <div className="df-add-actions df-add-actions--start">
        <Link to="/domains" className="df-button df-button--primary">
          {words.goToDomains}
        </Link>
        {!live && (
          <button type="button" className="df-button" disabled={busy} onClick={onCheck}>
            {words.checkAgain}
          </button>
        )}
        {live && more && (
          <button type="button" className="df-link-button" onClick={onNext}>
            {words.addNext}
          </button>
        )}
      </div>
    </section>
  )
}

export interface AddDomainProps {
  step: Step
  children: React.ReactNode
}

export const AddDomain = ({ step, children }: AddDomainProps) => (
  <div className="df-page df-list df-add-domain">
    <Header />
    <Steps step={step} />
    {children}
  </div>
)
