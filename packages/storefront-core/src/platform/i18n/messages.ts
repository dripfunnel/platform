// Core's own words: what every storefront says the same way, whatever its look. Per locale,
// falling back to English for a key a catalogue lacks (storefront ARCHITECTURE §2.1, §8).

export const en = {
  'cart.label': '{count, plural, =0 {Cart} other {Cart (#)}}',
  'nav.menu': 'Menu',
  'nav.main': 'Main menu',
  'nav.search': 'Search',
  'products.viewAll': 'View all',
  'newsletter.email': 'Email address',
  'newsletter.emailLabel': 'Your email address',
  'contact.email': 'Email',
  'contact.phone': 'Phone',
  'contact.visit': 'Visit',
  'price.inclTax': 'incl. tax',
  'price.plusTax': '+ tax',
  'price.was': 'Was {price}',
  'consent.title': 'Cookies on this site',
  'consent.body': 'We use cookies to make the shop work. With your permission we also use them to measure visits and show you relevant ads.',
  'consent.acceptAll': 'Accept all',
  'consent.rejectAll': 'Only necessary',
  'consent.analytics': 'Measuring visits',
  'consent.marketing': 'Ads and marketing',
  'consent.save': 'Save choices',
  'consent.customize': 'Choose',
  'consent.back': 'Back',
  'consent.settings': 'Cookie settings',
  'preview.banner': 'Preview — not your live shop. Orders here are test orders and nobody is charged.',
  'powered.by': 'Powered by {brand}',
  'legal.title': 'Legal information',
} as const

export type MessageKey = keyof typeof en
export type Catalogue = Partial<Record<MessageKey, string>>

/** Catalogues by language; a store's language falls back to its base language, then English. */
export const catalogues: Record<string, Catalogue> = { en }
