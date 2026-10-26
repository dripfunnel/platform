// The one place a mobile file reads storefront-core: the rules here copy the website's, and this test is what stops the copies drifting
// (the mobile apps may not import the published package, and it may not import the repo; shop/ARCHITECTURE.md §2).
import { addressFields as websiteFields, addressProblems as websiteProblems, type AddressDraft } from '../../../../../../../packages/storefront-core/src/checkout/address'
import { addressFields, addressProblems, type Draft } from './rules'

const countries = ['IN', 'US', 'GB', 'FR']

const complete: Record<string, Draft> = {
  IN: { name: 'Ana Rao', line1: '12 Sample Lane', line2: '', city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: '' },
  US: { name: 'Maya Chen', line1: '250 S High St', line2: '', city: 'Columbus', region: 'Ohio', postalCode: '43215', country: 'US', phone: '' },
  GB: { name: 'Tom Hall', line1: '1 High St', line2: '', city: 'Leeds', region: '', postalCode: 'LS1 4AB', country: 'GB', phone: '' },
  FR: { name: 'Lea Roux', line1: '3 Rue Verte', line2: '', city: 'Lyon', region: '', postalCode: '', country: 'FR', phone: '' },
}

/** One complete address per country, and the ways it goes wrong. */
const cases = (country: string): Draft[] => {
  const ok = complete[country] as Draft
  return [
    ok,
    { ...ok, name: '' },
    { ...ok, line1: ' ' },
    { ...ok, city: '' },
    { ...ok, region: '' },
    { ...ok, postalCode: '' },
    { ...ok, postalCode: '12' },
    { ...ok, postalCode: '302017' },
    { ...ok, phone: '+91 98765-43210' },
    { ...ok, phone: '98765 43210' },
    { ...ok, country: '' },
  ]
}

const asWebsite = (draft: Draft): AddressDraft => ({ ...draft, pin: null })

describe('the shop app’s address rules match the website’s', () => {
  it.each(countries)('%s: the same fields, in the same order, with the same labels and optional flags', (country) => {
    const shop = addressFields(country).map(({ field, label, optional }) => ({ field, label: String(label), optional }))
    const website = websiteFields(country).map(({ field, label, optional }) => ({ field, label: String(label), optional }))
    expect(shop).toEqual(website)
  })

  it.each(countries)('%s: the same problems for the same address', (country) => {
    for (const draft of cases(country)) expect(addressProblems(draft)).toEqual(websiteProblems(asWebsite(draft)))
  })
})
