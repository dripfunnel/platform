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
