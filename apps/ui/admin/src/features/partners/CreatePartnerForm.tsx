import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { messages } from '../../messages'
import { partnerCountries } from './partnerCountries'
import { draftErrors, draftFields, invitationChoices, type DraftErrors, type DraftField, type PartnerDraft } from './partnerDraft'
import '@dripfunnel/shared/ui/states.css'
import './partners.css'

const words = messages.partners.createForm

export interface CreatePartnerFormProps {
  initial: PartnerDraft
  // Errors to show from the start: the API's refusal, or the harness's ?state=invalid.
  errors: DraftErrors
  // A refusal that belongs to no one field, worded by its code.
  failure: string | null
  submitting: boolean
  onSubmit: (draft: PartnerDraft) => void
}

export const CreatePartnerForm = ({ initial, errors: given, failure, submitting, onSubmit }: CreatePartnerFormProps) => {
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState(given)
  const ids = { name: useId(), ownerEmail: useId(), country: useId(), hint: useId(), failure: useId() }
  const inputs = useRef<Partial<Record<DraftField, HTMLInputElement | HTMLSelectElement | null>>>({})

  const focusFirst = (found: DraftErrors) => {
    const first = draftFields.find((field) => found[field])
    if (first) inputs.current[first]?.focus()
  }

  useEffect(() => {
    setErrors(given)
    focusFirst(given)
  }, [given])

  const set = (field: keyof PartnerDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    if (field !== 'invitation') setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = draftErrors(draft)
    setErrors(found)
    if (draftFields.some((field) => found[field])) focusFirst(found)
    else onSubmit(draft)
  }

  const errorId = (field: DraftField) => `${ids[field]}-error`
  const describedBy = (field: DraftField, extra?: string) => [extra, errors[field] ? errorId(field) : undefined].filter(Boolean).join(' ') || undefined
  const fieldError = (field: DraftField) => {
    const code = errors[field]
    return code ? (
      <p id={errorId(field)} className="df-field-error">
        {words.errors[code]}
      </p>
    ) : null
  }

  return (
    <form className="df-create-partner" aria-label={words.formLabel} noValidate onSubmit={submit}>
      {failure && (
        <p id={ids.failure} className="df-form-failure" role="alert">
          {failure}
        </p>
      )}
      <div className="df-field">
        <label htmlFor={ids.name}>{words.name}</label>
        <input
          id={ids.name}
          ref={(node) => void (inputs.current.name = node)}
          autoComplete="organization"
          maxLength={120}
          placeholder={words.namePlaceholder}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy('name')}
          value={draft.name}
          onChange={(event) => set('name', event.target.value)}
        />
        {fieldError('name')}
      </div>
      <div className="df-field">
        <label htmlFor={ids.ownerEmail}>{words.ownerEmail}</label>
        <input
          id={ids.ownerEmail}
          ref={(node) => void (inputs.current.ownerEmail = node)}
          type="email"
          autoComplete="off"
          maxLength={254}
          placeholder={words.ownerEmailPlaceholder}
          aria-invalid={errors.ownerEmail ? true : undefined}
          aria-describedby={describedBy('ownerEmail', ids.hint)}
          value={draft.ownerEmail}
          onChange={(event) => set('ownerEmail', event.target.value)}
        />
        <p id={ids.hint} className="df-field-hint">
          {words.ownerEmailHint}
        </p>
        {fieldError('ownerEmail')}
      </div>
      <div className="df-field">
        <label htmlFor={ids.country}>{words.country}</label>
        <select
          id={ids.country}
          ref={(node) => void (inputs.current.country = node)}
          aria-invalid={errors.country ? true : undefined}
          aria-describedby={describedBy('country')}
          value={draft.country}
          onChange={(event) => set('country', event.target.value)}
        >
          <option value="">{words.countryPlaceholder}</option>
          {partnerCountries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        {fieldError('country')}
      </div>
      <fieldset className="df-choices">
        <legend>{words.invitation}</legend>
        {invitationChoices.map((choice) => (
          <label key={choice} className="df-choice">
            <input type="radio" name="invitation" value={choice} checked={draft.invitation === choice} onChange={() => set('invitation', choice)} />
            <span>
              <span className="df-choice-label">{words.invitations[choice].label}</span>
              <span className="df-choice-body">{words.invitations[choice].body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="df-form-actions">
        <button type="submit" className="df-button df-button--primary" disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? words.submitting : words.submit}
        </button>
        <Link to="/partners" className="df-button">
          {words.cancel}
        </Link>
      </div>
    </form>
  )
}
