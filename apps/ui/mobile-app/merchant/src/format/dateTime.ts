// Always with the zone's name, so a time is never read as the viewer's own (ui/README.md §4).
export const formatDateTime = (iso: string, locale: string, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(iso))

/** A day without a time ("5 Oct 2026"), in the given zone: an ISO date alone (the reference rates' "published on") is read as UTC. */
export const formatDay = (iso: string, locale: string, timeZone = 'UTC'): string =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso))

/** "Monday, 5 October", in the given zone. */
export const formatWeekdayDate = (date: Date, locale: string, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(date)

/** The hour of the day, 0 to 23, in the given zone. */
export const hourIn = (date: Date, timeZone: string): number => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date))
