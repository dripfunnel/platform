import { useState } from 'react'
import { updateCustomer, type Customer } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { TextField } from '../common/TextField'
import { countryOptions } from '../settings/countries'
import { FormSheet } from '../settings/FormSheet'
import { PickerField } from '../settings/PickerField'
import { editOf, formOfCustomer, problemWith, type EditForm } from './editDraft'

type Props = { client: ApiClient; customer: Customer; onClose: () => void; onDone: () => Promise<void> }

// "Edit details": name, number and the default delivery address, whole or not at all; past orders keep what they were placed with.
// A refusal (a number another customer has, or one they confirmed themselves) stays in the sheet with what was typed.
export function EditCustomerSheet({ client, customer, onClose, onDone }: Props) {
  const [form, setForm] = useState(() => formOfCustomer(customer))
  const set = (key: keyof EditForm, value: string) => setForm((current) => ({ ...current, [key]: value }))
  // A country outside the list (one the API already holds) stays choosable, so saving never silently drops it.
  const countries = [{ value: '', label: t('customers.editForm.noCountry') }, ...countryOptions()]
  const options = form.country === '' || countries.some((option) => option.value === form.country) ? countries : [...countries, { value: form.country, label: form.country }]
  return (
    <FormSheet
      title={t('customers.editForm.title', { name: customer.name ?? t('customers.row.noName') })}
      body={t('customers.editForm.body')}
      confirm={t('customers.editForm.save')}
      context="customers"
      onClose={onClose}
      check={() => problemWith(form)}
      onSubmit={async () => {
        await updateCustomer(client, customer.id, editOf(form))
        await onDone()
        return t('customers.editForm.saved')
      }}
    >
      <TextField label={t('customers.editForm.name')} value={form.name} onChangeText={(value) => set('name', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('customers.editForm.phone')} value={form.phone} onChangeText={(value) => set('phone', value)} keyboardType="phone-pad" autoComplete="tel" maxLength={40} />
      <TextField label={t('customers.editForm.address')} value={form.line1} onChangeText={(value) => set('line1', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('customers.editForm.line2')} value={form.line2} onChangeText={(value) => set('line2', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('customers.editForm.city')} value={form.city} onChangeText={(value) => set('city', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('customers.editForm.region')} value={form.region} onChangeText={(value) => set('region', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('customers.editForm.postal')} value={form.postal} onChangeText={(value) => set('postal', value)} maxLength={40} />
      <PickerField label={t('customers.editForm.country')} value={form.country} options={options} onChange={(value) => set('country', value)} searchable />
    </FormSheet>
  )
}
