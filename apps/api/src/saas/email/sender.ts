import type { Brand } from './render'
import type { Voice } from './compose'

// RFC 5322 needs a quoted display name in ASCII, and an RFC 2047 encoded word for anything else.
const displayName = (name: string) => {
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/["\\]/g, '\\$&')}"`
  const bytes = new TextEncoder().encode(name)
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`
}

/**
 * The addresses to send from, best first (SAAS §3.6): a partner's merchants', vendors' and shoppers' email comes from
 * `no-reply@<its live Email sender>`, then the fallback `no-reply@<label>.<sender domain>` that stands in until that
 * domain is live or when SES refuses it; DripFunnel's own email from `no-reply@<sender domain>` alone.
 */
export const fromAddresses = (voice: Voice, brand: Brand, senderDomain: string): string[] => {
  const from = (domain: string) => `${displayName(brand.name)} <no-reply@${domain}>`
  if (voice.kind !== 'partner') return [from(senderDomain)]
  const fallback = from(voice.label ? `${voice.label}.${senderDomain}` : senderDomain)
  return voice.emailHost ? [from(voice.emailHost), fallback] : [fallback]
}
