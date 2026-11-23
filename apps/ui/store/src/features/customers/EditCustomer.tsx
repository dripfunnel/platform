import { useEffect, useRef, useState, type ReactNode } from 'react'
import { updateCustomer, type Customer } from '../../api/customers'
import { fill, messages } from '../../messages'
import { AddressFields, addressDraftOf, addressInputOf, addressProblem } from './AddressFields'
import { CustomerFormField, type FieldAttrs } from './CustomerFormField'
import { customerFault, defaultAddress, type CustomerFault, type CustomerField } from './customerView'

const words = messages.customers.editForm

/** "Edit details": name, number and the default delivery address; past orders keep what they were placed with. */
export const EditCustomer = ({ customer, busy, act, onDone }: { customer: Customer; busy: boolean; act: (work: () => Promise<void>, done: string, onRefused?: (error: unknown) => boolean) => Promise<boolean>; onDone: () => void }) => {
  const [name, setName] = useState(customer.name ?? '')
  const [phone, setPhone] = useState(customer.phone ?? '')
  const [address, setAddress] = useState(() => addressDraftOf(defaultAddress(customer)))
  const [fault, setFault] = useState<CustomerFault | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])

  const save = () => {
    if (!name.trim()) return setFault({ field: 'name', text: words.nameMissing })
    const addressWrong = addressProblem(address)
    if (addressWrong) return setFault(addressWrong)
    setFault(null)
    const edit = {
      name: name.trim(),
      phone: phone.trim() || null,
      address: addressInputOf(address, name.trim()),
    }
    const refused = (error: unknown) => {
      const found = customerFault(error)
      setFault(found)
      return found !== null
    }
    void act(() => updateCustomer(customer.id, edit), words.saved, refused).then((ok) => ok && onDone())
  }

  const field = (which: CustomerField | null, label: string, value: string, set: (v: string) => void, extra: { hint?: string; ref?: typeof first; type?: string } = {}): ReactNode => (
    <CustomerFormField label={label} {...(extra.hint ? { hint: extra.hint } : {})} error={fault?.field === which ? fault.text : null} focusKey={fault} required={which === 'name'}>
      {(attrs: FieldAttrs) => <input {...attrs} ref={extra.ref} type={extra.type ?? 'text'} value={value} onChange={(event) => set(event.target.value)} />}
    </CustomerFormField>
  )

  const shown = fault?.field === 'form' ? fault.text : null
  return (
    <section className="df-customer df-customer-form" aria-label={fill(words.title, { name: customer.name ?? '' })}>
      <h2>{fill(words.title, { name: customer.name ?? '' })}</h2>
      <div className="df-form-grid">
        {field('name', words.name, name, setName, { ref: first })}
        {field('phone', words.phone, phone, setPhone, { type: 'tel' })}
      </div>
      <AddressFields draft={address} fault={fault} onChange={setAddress} />
      {shown && (
        <p className="df-form-problem" role="alert">
          {shown}
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
