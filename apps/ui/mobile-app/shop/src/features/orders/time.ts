import { locale } from '../../messages'

// Times are the store's, with the zone named, so they are never read as the phone's own (ui/README.md §4). The store's zone comes with
// every order read; a phone with none served falls back to its own.

const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** The zone a time is shown in: the store's if it is one Intl knows, else the phone's. */
export const zoneOf = (timeZone: string | null): string => {
  if (!timeZone) return deviceZone()
  try {
    new Intl.DateTimeFormat(locale, { timeZone })
    return timeZone
  } catch {
    return deviceZone()
  }
}

const day = (zone: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone })
const step = (zone: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' })
const clock = (zone: string) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' })

/** "27 Oct 2026". */
export const orderDay = (iso: string, zone: string): string => day(zone).format(new Date(iso))

/** "27 Oct, 10:40 IST": a step's time. */
export const stepTime = (iso: string, zone: string): string => step(zone).format(new Date(iso))

/** "10:52 IST": when a rider is expected, or a position was last reported. */
export const clockTime = (iso: string, zone: string): string => clock(zone).format(new Date(iso))
