// A link that a support agent pastes: https only, so it can't be a script or a local file.
export const ticketError = (ticket: string): boolean => {
  const value = ticket.trim()
  if (value === '') return false
  try {
    return new URL(value).protocol !== 'https:'
  } catch {
    return true
  }
}

/** Only an https address is followed or shown as a link, whatever an answer carried. */
export const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
