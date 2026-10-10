/** Only an https address is followed or shown as a link, whatever an answer carried. */
export const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
