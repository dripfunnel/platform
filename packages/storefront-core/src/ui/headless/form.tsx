'use client'

import { useId, useRef, type ReactNode } from 'react'
import { addressFields, fillFromPlace, type AddressDraft, type MapFilled, type AddressField, type FieldProblem } from '../../checkout/address'
import type { Translate } from '../../platform/i18n/i18n'
import { PinOnMap } from './pin'

// The checkout's and the account's form controls (ARCHITECTURE §2.1 `ui/headless`): a theme may not write <form> or
// <input> (§3.4), so core renders them, unstyled, with the theme's classes and words.

type Styled = { className?: string | undefined }

/** A form that hands its fields over on submit; nothing is posted, so a step's Continue and Enter both work. */
export const Form = ({ onSubmit, label, className, children }: Styled & { onSubmit: () => void; label?: string; children: ReactNode }) => (
  <form
    className={className}
    aria-label={label}
    noValidate
    onSubmit={(e) => {
      e.preventDefault()
      onSubmit()
    }}
  >
    {children}
  </form>
)

/** A submit button for core's Form. */
export const SubmitButton = ({ children, disabled, className }: Styled & { children: ReactNode; disabled?: boolean }) => (
  <button type="submit" className={className} disabled={disabled}>
    {children}
  </button>
)

export type TextFieldProps = Styled & {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'tel' | 'password' | 'date'
  autoComplete?: string
  inputMode?: 'text' | 'email' | 'tel' | 'numeric'
  /** Words after the label, such as "Optional". */
  note?: string | undefined
  hint?: string | undefined
  /** What's wrong with it, in the theme's words; the field is marked invalid while it is set. */
  error?: string | null | undefined
  maxLength?: number
}

/** A labelled text field with its hint and its error, each tied to it for screen readers. */
export const TextField = ({ label, value, onChange, type = 'text', autoComplete, inputMode, note, hint, error, maxLength = 200, className }: TextFieldProps) => {
  const id = useId()
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ')
  return (
    <span className={className}>
      <label htmlFor={id}>
        {label}
        {note ? <small> {note}</small> : null}
      </label>
      <input id={id} type={type} value={value} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={described || undefined} onChange={(e) => onChange(e.target.value)} />
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
      {error ? (
        <small id={`${id}-error`} role="alert">
          {error}
        </small>
      ) : null}
    </span>
  )
}

/** One choice of several, as radio buttons in a fieldset: each option's content is the theme's. */
export const Choices = <V extends string>({ legend, value, options, onChange, className, optionClassName, chosenClassName }: Styled & { legend: string; value: V | null; options: readonly { value: V; content: ReactNode }[]; onChange: (value: V) => void; optionClassName?: string; chosenClassName?: string }) => {
  const name = useId()
  return (
    <fieldset className={className}>
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={o.value === value ? (chosenClassName ?? optionClassName) : optionClassName}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          {o.content}
        </label>
      ))}
    </fieldset>
  )
}

/** The delivery address's fields for its country (address.ts), with core's labels; the theme gives the country list. */
export const AddressFields = ({ value, onChange, countries, errors, t, locale, fieldClassName, className }: Styled & {
  value: AddressDraft
  onChange: (value: AddressDraft) => void
  countries: readonly string[]
  errors: Partial<Record<AddressField, FieldProblem>>
  t: Translate
  locale: string
  fieldClassName?: string
}) => {
  const id = useId()
  const mapFilled = useRef<MapFilled>({})
  const names = new Intl.DisplayNames([locale], { type: 'region' })
  const problem = (p: FieldProblem | undefined) => (p === 'required' ? t('address.required') : p === 'invalid' ? t('address.invalid') : null)
  return (
    <div className={className}>
      <span className={fieldClassName}>
        <label htmlFor={id}>{t('address.country')}</label>
        <select id={id} value={value.country} autoComplete="shipping country" aria-invalid={errors.country ? true : undefined} aria-describedby={errors.country ? `${id}-error` : undefined} onChange={(e) => onChange({ ...value, country: e.target.value })}>
          {value.country ? null : <option value="">{t('address.chooseCountry')}</option>}
          {(countries.includes(value.country) || !value.country ? countries : [value.country, ...countries]).map((c) => (
            <option key={c} value={c}>
              {names.of(c) ?? c}
            </option>
          ))}
        </select>
        {errors.country ? (
          <small id={`${id}-error`} role="alert">
            {problem(errors.country)}
          </small>
        ) : null}
      </span>
      {addressFields(value.country).map((f) => (
        <TextField
          key={f.field}
          label={t(f.label)}
          note={f.optional ? t('address.optional') : undefined}
          value={value[f.field]}
          type={f.field === 'phone' ? 'tel' : 'text'}
          autoComplete={f.autoComplete}
          error={f.field === 'phone' && errors.phone === 'invalid' ? t('address.phoneInvalid') : problem(errors[f.field])}
          onChange={(v) => onChange({ ...value, [f.field]: v })}
          className={fieldClassName}
        />
      ))}
      <PinOnMap
        value={value.pin ?? null}
        onChange={(pin, place) => {
          const { draft, filled } = fillFromPlace(value, place ?? null, countries, mapFilled.current)
          mapFilled.current = filled
          onChange({ ...draft, pin })
        }}
        address={[value.line1, value.line2, value.city, value.region, value.postalCode].map((p) => p.trim()).filter(Boolean).join(', ')}
        country={value.country}
        t={t}
        locale={locale}
        className={fieldClassName}
      />
    </div>
  )
}
