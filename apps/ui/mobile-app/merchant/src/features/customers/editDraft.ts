import type { Customer, CustomerAddressInput } from '../../api/customers'
import { t } from '../../messages'
import { defaultAddress } from './customerFacts'

// "Edit details" as typed: the name, the number and the default delivery address as its parts, since `updateCustomer` takes them that way.
export type EditForm = { name: string; phone: string; line1: string; line2: string; city: string; region: string; postal: string; country: string }

export const formOfCustomer = (customer: Customer): EditForm => {
  const address = defaultAddress(customer)
  return {
    name: customer.name ?? '',
    phone: customer.phone ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    region: address?.region ?? '',
    postal: address?.postalCode ?? '',
    country: address?.country ?? '',
  }
}

const hasAddress = (form: EditForm): boolean => [form.line1, form.line2, form.city, form.region, form.postal, form.country].some((part) => part.trim() !== '')

/** What is wrong with the form, said before anything is sent: a name is needed, and an address is whole or not at all. */
export const problemWith = (form: EditForm): string | null => {
  if (form.name.trim() === '') return t('customers.editForm.nameMissing')
  if (hasAddress(form) && [form.line1, form.city, form.country].some((part) => part.trim() === '')) return t('customers.editForm.addressPartial')
  return null
}

export const editOf = (form: EditForm): { name: string; phone: string | null; address: CustomerAddressInput | null } => ({
  name: form.name.trim(),
  phone: form.phone.trim() || null,
  address: hasAddress(form)
    ? { name: form.name.trim(), line1: form.line1.trim(), line2: form.line2.trim() || null, city: form.city.trim(), region: form.region.trim() || null, postalCode: form.postal.trim() || null, country: form.country.trim().toUpperCase() }
    : null,
})
