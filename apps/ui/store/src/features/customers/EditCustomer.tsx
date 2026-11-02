import { useEffect, useRef, useState, type ReactNode } from 'react'
import { updateCustomer, type Customer } from '../../api/customers'
import { fill, messages } from '../../messages'
import { CustomerFormField, type FieldAttrs } from './CustomerFormField'
import { customerFault, defaultAddress, type CustomerFault, type CustomerField } from './customerView'

const words = messages.customers.editForm

/** "Edit details": name, number and the default delivery address; past orders keep what they were placed with. */
export const EditCustomer = ({ customer, busy, act, onDone }: { customer: Customer; busy: boolean; act: (work: () => Promise<void>, done: string, onRefused?: (error: unknown) => boolean) => Promise<boolean>; onDone: () => void }) => {
  const address = defaultAddress(customer)
  const [name, setName] = useState(customer.name ?? '')
  const [phone, setPhone] = useState(customer.phone ?? '')
  const [line1, setLine1] = useState(address?.line1 ?? '')
  const [line2, setLine2] = useState(address?.line2 ?? '')
  const [city, setCity] = useState(address?.city ?? '')
  const [region, setRegion] = useState(address?.region ?? '')
  const [postal, setPostal] = useState(address?.postalCode ?? '')
  const [country, setCountry] = useState(address?.country ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [fault, setFault] = useState<CustomerFault | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])

  const save = () => {
    const filled = [line1, city, country].map((v) => v.trim())
    const anyAddress = [line1, line2, city, region, postal, country].some((v) => v.trim() !== '')
    if (!name.trim()) return setProblem(words.nameMissing)
    if (anyAddress && filled.some((v) => v === '')) return setProblem(words.addressPartial)
    if (anyAddress && !/^[A-Za-z]{2}$/.test(country.trim())) return setProblem(words.countryInvalid)
    setProblem(null)
    setFault(null)
    const edit = {
      name: name.trim(),
      phone: phone.trim() || null,
      address: anyAddress ? { name: name.trim(), line1: line1.trim(), line2: line2.trim() || null, city: city.trim(), region: region.trim() || null, postalCode: postal.trim() || null, country: country.trim().toUpperCase() } : null,
    }
    const refused = (error: unknown) => {
      const found = customerFault(error)
      setFault(found)
      return found !== null
    }
    void act(() => updateCustomer(customer.id, edit), words.saved, refused).then((ok) => ok && onDone())
  }

  const field = (which: CustomerField | null, label: string, value: string, set: (v: string) => void, extra: { hint?: string; ref?: typeof first; type?: string } = {}): ReactNode => (
    <CustomerFormField label={label} {...(extra.hint ? { hint: extra.hint } : {})} error={fault?.field === which ? fault.text : null}>
      {(attrs: FieldAttrs) => <input {...attrs} ref={extra.ref} type={extra.type ?? 'text'} value={value} onChange={(event) => set(event.target.value)} />}
    </CustomerFormField>
  )

  return (
    <section className="df-customer df-customer-form" aria-label={fill(words.title, { name: customer.name ?? '' })}>
      <h2>{fill(words.title, { name: customer.name ?? '' })}</h2>
      <div className="df-form-grid">
        {field('name', words.name, name, setName, { ref: first })}
        {field('phone', words.phone, phone, setPhone, { type: 'tel' })}
      </div>
      {field('address', words.address, line1, setLine1)}
      {field(null, words.line2, line2, setLine2)}
      <div className="df-form-grid">
        {field(null, words.city, city, setCity)}
        {field(null, words.region, region, setRegion)}
        {field(null, words.postal, postal, setPostal)}
        {field('country', words.country, country, setCountry, { hint: words.countryHint })}
      </div>
      {problem && (
        <p className="df-form-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="df-form-actions">
        <button type="button" className="df-button" onClick={onDone}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy} onClick={save}>
          {words.save}
        </button>
      </div>
    </section>
  )
}
