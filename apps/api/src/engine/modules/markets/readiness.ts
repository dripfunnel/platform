// Ready to sell per market (CATALOG T2; FIRST-RELEASE §11's "ready to sell" column), as the prototype's
// marketStatus reckons it: a price the market can charge, and for a physical product the details its
// countries require (CATALOG fact 45, India and the US at launch, decided on #184).

/** What each launch country requires of a physical product: fibre content, origin and care (FTC); origin and MRP. */
export const countryNeeds: Readonly<Record<string, readonly ReadinessNeed[]>> = {
  US: ['fibre', 'origin', 'care'],
  IN: ['origin', 'compare'],
}

export type ReadinessNeed = 'price' | 'fibre' | 'origin' | 'care' | 'compare'

export interface ReadinessFacts {
  productType: string
  /** Whether the market has a price for some version (typed, converted or adjusted). */
  priced: boolean
  /** A compare-at price (India's MRP) on some version, in the pricing currency. */
  hasCompareAt: boolean
  /** Compliance fields with a value, as region:field ('US:fibre', 'ALL:origin'). */
  compliance: ReadonlySet<string>
}

/** What the product still lacks to sell in a market of these countries, in a stable order. */
export const missingFor = (facts: ReadinessFacts, countries: readonly string[]): ReadinessNeed[] => {
  const missing: ReadinessNeed[] = facts.priced || facts.productType === 'gift_card' ? [] : ['price']
  if (facts.productType !== 'physical') return missing
  for (const need of ['fibre', 'origin', 'care', 'compare'] as const) {
    const required = countries.filter((c) => countryNeeds[c]?.includes(need))
    const met = need === 'compare' ? facts.hasCompareAt : required.every((c) => facts.compliance.has(`${c}:${need}`) || facts.compliance.has(`ALL:${need}`))
    if (required.length > 0 && !met) missing.push(need)
  }
  return missing
}
