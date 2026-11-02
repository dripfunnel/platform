import { looksLikeEmail } from '@dripfunnel/shared/format'
import { useEffect, useRef, useState } from 'react'
import { messages } from '../../messages'
import { PhoneInput } from '../common/PhoneInput'
import { CustomerFormField } from './CustomerFormField'
import type { CustomerFault, CustomerField } from './customerView'

const words = messages.customers.addForm

/** "Add a customer" (PortalOrders): for people who buy in person or by phone; adding them sends them nothing. */
export const AddCustomer = ({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (name: string, email: string, phone: string | null) => Promise<CustomerFault | null>; onCancel: () => void }) => {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [fault, setFault] = useState<CustomerFault | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const add = () => {
    if (!name.trim()) return setProblem(words.nameMissing)
    if (!looksLikeEmail(email.trim())) return setProblem(words.emailInvalid)
    setProblem(null)
    setFault(null)
    void onAdd(name.trim(), email.trim().toLowerCase(), phone.trim() || null).then(setFault)
  }
  const at = (field: CustomerField) => (fault?.field === field ? fault.text : null)
  return (
    <section className="df-customer-card df-customer-form" aria-label={words.title}>
      <h2>{words.title}</h2>
      <p className="df-customer-sub">{words.body}</p>
      <div className="df-form-grid">
        <CustomerFormField label={words.name} error={at('name')}>
          {(attrs) => <input {...attrs} ref={first} value={name} placeholder={words.namePlaceholder} onChange={(event) => setName(event.target.value)} />}
        </CustomerFormField>
        <CustomerFormField label={words.email} error={at('email')}>
          {(attrs) => <input {...attrs} type="email" value={email} placeholder={words.emailPlaceholder} onChange={(event) => setEmail(event.target.value)} />}
        </CustomerFormField>
        <CustomerFormField label={words.phone} error={at('phone')}>
          {({ 'aria-invalid': invalid, ...attrs }) => <PhoneInput {...attrs} invalid={invalid} value={phone} onValue={setPhone} />}
        </CustomerFormField>
      </div>
      {problem && (
        <p className="df-form-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="df-form-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy} onClick={add}>
          {words.confirm}
        </button>
      </div>
    </section>
  )
}
