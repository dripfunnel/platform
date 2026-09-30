export const formatNumber = (value: number, locale: string): string => new Intl.NumberFormat(locale).format(value)
