import type { Brand } from './render'
import type { Voice } from './compose'

// RFC 5322 needs a quoted display name in ASCII, and an RFC 2047 encoded word for anything else.
const displayName = (name: string) => {
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/["\\]/g, '\\$&')}"`
  const bytes = new TextEncoder().encode(name)
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`
}

/**
 * Until a partner's own sender domain has its SES identity (slice 11), its merchants' email comes
 * from the fallback, `no-reply@<label>.<sender domain>`, in its name (SAAS §3.6); DripFunnel's own
 * email from `no-reply@<sender domain>`.
 */
export const fromAddress = (voice: Voice, brand: Brand, senderDomain: string): string => {
  const domain = voice.kind === 'partner' && voice.label ? `${voice.label}.${senderDomain}` : senderDomain
  return `${displayName(brand.name)} <no-reply@${domain}>`
}
