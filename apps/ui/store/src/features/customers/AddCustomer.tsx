import { looksLikeEmail } from '@dripfunnel/shared/format'
import { useEffect, useRef, useState } from 'react'
import { messages } from '../../messages'

const words = messages.customers.addForm

/** "Add a customer" (PortalOrders): for people who buy in person or by phone; adding them sends them nothing. */
export const AddCustomer = ({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (name: string, email: string, phone: string | null) => void; onCancel: () => void }) => {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const add = () => {
    if (!name.trim()) return setProblem(words.nameMissing)
    if (!looksLikeEmail(email.trim())) return setProblem(words.emailInvalid)
    setProblem(null)
    onAdd(name.trim(), email.trim().toLowerCase(), phone.trim() || null)
  }
  return (
    <section className="df-customer-card df-customer-form" aria-label={words.title}>
      <h2>{words.title}</h2>
      <p className="df-customer-sub">{words.body}</p>
      <div className="df-form-grid">
        <label className="df-form-field">
          <span>{words.name}</span>
          <input ref={first} value={name} placeholder={words.namePlaceholder} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="df-form-field">
          <span>{words.email}</span>
          <input type="email" value={email} placeholder={words.emailPlaceholder} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="df-form-field">
          <span>{words.phone}</span>
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
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
