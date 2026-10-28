/** The first letters of up to two words of a name, for the avatar; `?` for none. */
export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'
