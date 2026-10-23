/** "a, b and c" as the locale joins a list. */
export const formatList = (items: readonly string[], locale: string): string => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items)
