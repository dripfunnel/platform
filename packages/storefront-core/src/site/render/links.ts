export type PolicyKind = 'shipping' | 'returns' | 'privacy' | 'terms'

/** Where the site's links go; the template supplies its routes. */
export type SiteLinks = {
  home: string
  shop: string
  cart: string
  about: string
  contact: string
  search: (query: string) => string
  policy: (kind: PolicyKind) => string
}

const rules: [RegExp, (l: SiteLinks) => string][] = [
  [/about|story|atelier/i, (l) => l.about],
  [/contact|support/i, (l) => l.contact],
  [/shipping|delivery/i, (l) => l.policy('shipping')],
  [/return|refund/i, (l) => l.policy('returns')],
  [/privacy/i, (l) => l.policy('privacy')],
  [/terms/i, (l) => l.policy('terms')],
]

/** A menu or footer label's page: About and Contact by name (the schema's rule), policies by name, else the shop. */
export const hrefForLabel = (label: string, links: SiteLinks): string => (rules.find(([re]) => re.test(label))?.[1] ?? ((l: SiteLinks) => l.shop))(links)
