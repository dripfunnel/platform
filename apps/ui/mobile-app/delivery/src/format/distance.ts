/** A distance given in metres, in kilometres from 1 km and in metres below it: "2.4 km", "800 m". */
export const formatDistance = (metres: number, locale: string): string =>
  metres >= 1000
    ? new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilometer', unitDisplay: 'short', maximumFractionDigits: 1 }).format(metres / 1000)
    : new Intl.NumberFormat(locale, { style: 'unit', unit: 'meter', unitDisplay: 'short', maximumFractionDigits: 0 }).format(Math.max(0, Math.round(metres)))
