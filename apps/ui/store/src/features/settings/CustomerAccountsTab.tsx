import { useId, useState } from 'react'
import { saveCustomerAccounts, signInModes, type CustomerAccounts, type SignInMode } from '../../api/customerAccounts'
import { fill, formatCount, messages, plural } from '../../messages'
import { productName } from '../common/productName'
import { RadioCards } from '../common/RadioCards'
import { refusalIn } from '../common/refusal'

const words = messages.settings.customers
const refusalOf = refusalIn(words.refused)

export interface CustomerAccountsTabProps {
  accounts: CustomerAccounts
  country: string | null
  canEdit: boolean
  onSaved: (toast: string) => void
}

/** Customer accounts (SetAccess "customers", ACCESS §2.1): how shoppers sign in, and what they see. */
export const CustomerAccountsTab = ({ accounts, country, canEdit, onSaved }: CustomerAccountsTabProps) => {
  const id = useId()
  const [saved, setSaved] = useState(accounts)
  const [mode, setMode] = useState<SignInMode>(accounts.mode)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const india = country === 'IN'
  // Phone-only shoppers can't sign in to a store taking email only until ACCESS §2.1's add-an-email step exists.
  const dropsMobile = saved.mode !== 'email' && mode === 'email' && saved.phoneOnly > 0

  const save = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const next = await saveCustomerAccounts(mode)
      setSaved(next)
      setMode(next.mode)
      onSaved(words.saved)
    } catch (error) {
      setFailure(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="df-set-store">
      <div>
        <h2 className="df-set-title">{words.title}</h2>
        <p className="df-set-sub">{words.sub}</p>
      </div>
      <section className="df-set-card" aria-labelledby={`${id}-modes`}>
        <h2 id={`${id}-modes`} className="df-visually-hidden">
          {words.modesLabel}
        </h2>
        {failure && (
          <p className="df-set-failure" role="alert">
            {failure}
          </p>
        )}
        <RadioCards
          labelledBy={`${id}-modes`}
          className="df-radio-cards--stack"
          value={mode}
          disabled={!canEdit || busy}
          onChange={setMode}
          options={signInModes.map((m) => ({ value: m, label: words.modes[m].label, sub: words.modes[m].sub + (m === 'both' && india ? words.bothIndia : '') }))}
        />
      </section>
      {dropsMobile && (
        <p className="df-set-warning" role="status">
          {fill(plural(words.dropsMobile, saved.phoneOnly), { count: formatCount(saved.phoneOnly) })}
        </p>
      )}
      <section className="df-set-card" aria-labelledby={`${id}-see`}>
        <h2 id={`${id}-see`}>{words.seeTitle}</h2>
        <p className="df-set-text">{words.see[mode]}</p>
        <p className="df-set-text">{fill(words.guests, { key: words.guestKey[mode], phone: mode === 'email' ? '' : words.guestPhone })}</p>
        {mode !== 'email' && <span className="df-set-help">{fill(words.sms, { partner: productName(), service: india ? words.smsServices.IN : words.smsServices.other })}</span>}
      </section>
      <div className="df-set-foot">
        <span className="df-set-help">
          {fill(words.counts, {
            customers: fill(plural(words.customersCount, saved.customers), { count: formatCount(saved.customers) }),
            email: formatCount(saved.withEmail),
            phone: formatCount(saved.withPhone),
          })}
        </span>
        {canEdit && (
          <button type="button" className="df-button df-button--primary" disabled={busy || mode === saved.mode} onClick={() => void save()}>
            {words.save}
          </button>
        )}
      </div>
    </div>
  )
}
