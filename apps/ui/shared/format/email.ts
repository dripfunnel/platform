// Whether typed text has the shape of an email address: loose on purpose (decided on #45); the
// invitation itself proves the address. Moved here when the partner console's invite needed it (#193).
export const looksLikeEmail = (text: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
