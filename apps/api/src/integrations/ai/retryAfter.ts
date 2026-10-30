/** A Retry-After header as whole seconds from `now`: delta-seconds or an HTTP-date (RFC 9110 §10.2.3); null when absent or unreadable. */
export const parseRetryAfter = (value: string | null | undefined, now: Date): number | null => {
  const text = value?.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  const at = /[a-z]{3}/i.test(text) ? Date.parse(text) : NaN
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now.getTime()) / 1000))
}
