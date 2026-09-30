// Always with the zone's name, so a time is never read as the viewer's own (ui/README §4).
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
