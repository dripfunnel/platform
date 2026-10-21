import { useState } from 'react'
import { addCustomer } from '../../api/customers'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { TextField } from '../common/TextField'
import { looksLikeEmail } from '../settings/email'
import { FormSheet } from '../settings/FormSheet'

type Props = { client: ApiClient; onClose: () => void; onOpen: (id: string) => void }

// "Add a customer" (PortalOrders): for people who buy in person or by phone; adding them sends them nothing. An email that is already a
// customer opens that one, and says so.
export function AddCustomerSheet({ client, onClose, onOpen }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  return (
    <FormSheet
      title={t('customers.addForm.title')}
      body={t('customers.addForm.body')}
      confirm={t('customers.addForm.confirm')}
      context="customers"
      onClose={onClose}
      check={() => (name.trim() === '' ? t('customers.addForm.nameMissing') : !looksLikeEmail(email) ? t('customers.addForm.emailInvalid') : null)}
      onSubmit={async () => {
        const typed = name.trim()
        const { id, existed } = await addCustomer(client, typed, email.trim().toLowerCase(), phone.trim() || null)
        onOpen(id)
        return t(existed ? 'customers.addForm.existed' : 'customers.addForm.added', { name: typed })
      }}
    >
      <TextField label={t('customers.addForm.name')} value={name} onChangeText={setName} placeholder={t('customers.addForm.namePlaceholder')} autoCapitalize="words" maxLength={120} />
      <TextField label={t('customers.addForm.email')} value={email} onChangeText={setEmail} placeholder={t('customers.addForm.emailPlaceholder')} keyboardType="email-address" autoComplete="email" maxLength={254} />
      <TextField label={t('customers.addForm.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={40} />
    </FormSheet>
  )
}
