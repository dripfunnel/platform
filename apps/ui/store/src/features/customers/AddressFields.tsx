import type { CustomerAddress, CustomerAddressInput } from '../../api/customers'
import { messages } from '../../messages'
import { CustomerFormField } from './CustomerFormField'
import type { CustomerFault } from './customerView'

const words = messages.customers.editForm

export interface AddressDraft {
  line1: string
  line2: string
  city: string
  region: string
  postal: string
  country: string
}

export const emptyAddress: AddressDraft = { line1: '', line2: '', city: '', region: '', postal: '', country: '' }

export const addressDraftOf = (address: CustomerAddress | null): AddressDraft =>
  address ? { line1: address.line1, line2: address.line2 ?? '', city: address.city, region: address.region ?? '', postal: address.postalCode ?? '', country: address.country } : emptyAddress

const isFilled =(d: AddressDraft) => Object.values(d).some((v) => v.trim() !== '')

/** The address is optional as a whole; once any part is typed the street, city and a two-letter country are needed. */
export const addressProblem = (d: AddressDraft): CustomerFault | null => {
  if (!isFilled(d)) return null
  if ([d.line1, d.city, d.country].some((v) => v.trim() === '')) return { field: 'address', text: words.addressPartial }
  return /^[A-Za-z]{2}$/.test(d.country.trim()) ? null : { field: 'country', text: words.countryInvalid }
}

export const addressInputOf = (d: AddressDraft, name: string): CustomerAddressInput | null =>
  isFilled(d) ? { name, line1: d.line1.trim(), line2: d.line2.trim() || null, city: d.city.trim(), region: d.region.trim() || null, postalCode: d.postal.trim() || null, country: d.country.trim().toUpperCase() } : null

/** The address fields of "Edit details" and "Add a customer", in one order and with the same words. */
export const AddressFields = ({ draft, fault, onChange }: { draft: AddressDraft; fault: CustomerFault | null; onChange: (draft: AddressDraft) => void }) => {
  const field = (key: keyof AddressDraft, label: string, error: string | null, hint?: string) => (
    <CustomerFormField label={label} {...(hint ? { hint } : {})} error={error} focusKey={fault}>
      {(attrs) => <input {...attrs} type="text" value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} />}
    </CustomerFormField>
  )
  const at = (which: 'address' | 'country') => (fault?.field === which ? fault.text : null)
  return (
    <>
      {field('line1', words.address, at('address'))}
      {field('line2', words.line2, null)}
      <div className="df-form-grid">
        {field('city', words.city, null)}
        {field('region', words.region, null)}
        {field('postal', words.postal, null)}
        {field('country', words.country, at('country'), words.countryHint)}
      </div>
    </>
  )
}
