import { looksLikeEmail } from '@dripfunnel/shared/format'
import { useEffect, useId, useRef, useState } from 'react'
import { saveBillingDetails, type BillingDetails, type BillingStoreInfo } from '../../api/billing'
import { messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { taxIdKindOf } from './billingView'
import '../common/form.css'

const words = messages.billing.details
const refused = refusalIn(messages.billing.refused)

type Form = { legalName: string; email: string; line1: string; line2: string; city: string; region: string; postal: string; country: string; taxId: string }

// Before any are saved, the store's own details start the form (the prototype's), its country the one it signed up in.
const formOf = (details: BillingDetails | null, store: BillingStoreInfo | null): Form =>
  details
    ? { legalName: details.legalName, email: details.email, ...details.address, line2: details.address.line2 ?? '', region: details.address.region ?? '', taxId: details.taxId ?? '' }
    : {
        legalName: store?.legalName ?? store?.name ?? '',
        email: store?.contactEmail ?? '',
        line1: store?.address?.street ?? '',
        line2: '',
        city: store?.address?.city ?? '',
        region: store?.address?.region ?? '',
        postal: store?.address?.postal ?? '',
        country: store?.country ?? '',
        taxId: store?.taxId ?? '',
      }

/** "Details on your invoices" (PortalBilling, SAAS §7.2): new invoices use them; the API checks the tax number. */
export const BillingDetailsDialog = ({ details, store, sample, onSaved, onCancel }: { details: BillingDetails | null; store: BillingStoreInfo | null; sample: boolean; onSaved: (details: BillingDetails) => void; onCancel: () => void }) => {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [form, setForm] = useState<Form>(() => formOf(details, store))
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
  }, [])

  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }))
  const country = form.country.trim().toUpperCase()

  const save = () => {
    const required = [form.legalName, form.email, form.line1, form.city, form.postal, form.country]
    if (required.some((v) => v.trim() === '')) return setProblem(words.form.missing)
    if (!looksLikeEmail(form.email.trim())) return setProblem(words.form.badEmail)
    if (!/^[A-Z]{2}$/.test(country)) return setProblem(words.form.badCountry)
    setProblem(null)
    const input = {
      legalName: form.legalName.trim(),
      email: form.email.trim(),
      address: { line1: form.line1.trim(), line2: form.line2.trim() || null, city: form.city.trim(), region: form.region.trim() || null, postal: form.postal.trim(), country },
      taxId: form.taxId.trim() || null,
    }
    const kind = taxIdKindOf(country)
    if (sample) return onSaved({ ...input, taxIdKind: input.taxId && kind !== 'other' ? kind : null })
    setBusy(true)
    saveBillingDetails(input)
      .then(onSaved)
      .catch((error: unknown) => setProblem(refused(error)))
      .finally(() => setBusy(false))
  }

  const field = (key: keyof Form, label: string, extra: { hint?: string; type?: string; autoComplete?: string } = {}) => (
    <label className="df-form-field">
      <span>
        {label} {extra.hint && <small>{extra.hint}</small>}
      </span>
      <input type={extra.type ?? 'text'} autoComplete={extra.autoComplete} value={form[key]} onChange={set(key)} />
    </label>
  )

  return (
    <dialog ref={ref} className="df-dialog df-billing-dialog" aria-labelledby={`${id}-t`} onCancel={(e) => (e.preventDefault(), onCancel())}>
      <h2 id={`${id}-t`}>{words.form.title}</h2>
      <p className="df-billing-note">{words.form.body}</p>
      {field('legalName', words.form.legalName, { autoComplete: 'organization' })}
      {field('email', words.form.email, { type: 'email', autoComplete: 'email' })}
      {field('line1', words.form.line1, { autoComplete: 'address-line1' })}
      {field('line2', words.form.line2, { autoComplete: 'address-line2' })}
      <div className="df-form-grid">
        {field('city', words.form.city, { autoComplete: 'address-level2' })}
        {field('region', words.form.region, { autoComplete: 'address-level1' })}
        {field('postal', words.form.postal, { autoComplete: 'postal-code' })}
        {field('country', words.form.country, { hint: words.form.countryHint, autoComplete: 'country' })}
      </div>
      {field('taxId', words.taxId[taxIdKindOf(/^[A-Z]{2}$/.test(country) ? country : null)], { hint: words.form.taxIdHint })}
      {problem && (
        <p className="df-form-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="df-form-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.form.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy} onClick={save}>
          {words.form.save}
        </button>
      </div>
    </dialog>
  )
}
