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
