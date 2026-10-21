const rules = new Map<string, Intl.PluralRules>()

// Picks the form the locale's plural rules give for this count; `other` is always present.
export const pluralForm = (locale: string, forms: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>, count: number): string => {
  const rule = rules.get(locale) ?? new Intl.PluralRules(locale)
  rules.set(locale, rule)
  return forms[rule.select(count)] ?? forms.other
}
