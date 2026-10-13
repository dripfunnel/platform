// The bank account fields Stripe.js turns into a `btok_` token (THIRD-PARTY-ACCESS §2.7): an IBAN country is
// asked for holder and IBAN alone, any other for a routing number too. None of it is sent to the API.
const ibanCountries = new Set('AT BE BG CH CY CZ DE DK EE ES FI FR GR HR HU IE IS IT LI LT LU LV MT NL NO PL PT RO SE SI SK'.split(' '))

export const needsRouting = (country: string): boolean => !ibanCountries.has(country)

export interface BankFields {
  holder: string
  routing: string
  number: string
}

const squeeze = (value: string) => value.replace(/\s/g, '')

export const bankComplete = (country: string, fields: BankFields): boolean =>
  fields.holder.trim() !== '' && squeeze(fields.number).length >= 8 && (!needsRouting(country) || squeeze(fields.routing).length >= 4)

export const bankTokenData = (country: string, currency: string, fields: BankFields) => ({
  country,
  currency: currency.toLowerCase(),
  account_holder_name: fields.holder.trim(),
  account_holder_type: 'company' as const,
  account_number: squeeze(fields.number),
  ...(needsRouting(country) ? { routing_number: squeeze(fields.routing) } : {}),
})
