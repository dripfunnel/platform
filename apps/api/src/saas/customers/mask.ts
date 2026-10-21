// ui/admin/FIRST-RELEASE.md §5.4: the list shows `pr***@gmail.com` and `+91 ***** 43210`, for
// every role. Masked here, in the API, so the full value never reaches the console's list.

export const maskEmail = (email: string | null): string | null => {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  // Two letters of a long name, one of a short one, none of a name too short to hide.
  const shown = at >= 5 ? 2 : at >= 3 ? 1 : 0
  return `${email.slice(0, shown)}***${email.slice(at)}`
}

export const maskPhone = (phone: string | null, countryCode: string | null): string | null => {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const national = countryCode && digits.startsWith(countryCode) ? digits.slice(countryCode.length) : digits
  // Five digits show only where enough stay hidden; a short number shows two.
  const shown = national.length >= 8 ? 5 : 2
  return `${countryCode ? `+${countryCode} ` : ''}***** ${national.slice(-shown)}`
}

/** A search term as §5.4 reads it: an exact email, an exact phone by its digits, or a name. */
export const classifySearch = (raw: string): { kind: 'email'; email: string } | { kind: 'phone'; digits: string } | { kind: 'name'; term: string } | null => {
  const term = raw.trim()
  if (term.includes('@')) return { kind: 'email', email: term }
  if (/^[+\d\s().-]+$/.test(term)) {
    const digits = term.replace(/\D/g, '')
    return digits.length >= 6 && digits.length <= 15 ? { kind: 'phone', digits } : null
  }
  return term.length >= 2 ? { kind: 'name', term: term.slice(0, 100) } : null
}
