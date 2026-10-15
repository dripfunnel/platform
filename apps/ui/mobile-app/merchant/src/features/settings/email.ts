/** A shape check before an invitation is sent; the server decides whether the address is a real one. */
export const looksLikeEmail = (text: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
