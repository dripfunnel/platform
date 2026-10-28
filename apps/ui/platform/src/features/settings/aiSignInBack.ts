/** Only an https address is opened, whatever an answer carried. */
export const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
