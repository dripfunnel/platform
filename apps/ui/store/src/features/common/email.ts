/** Something that could be an address: one @, a dot after it, no spaces. The API decides the rest. */
export const looksLikeEmail = (text: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text.trim())
