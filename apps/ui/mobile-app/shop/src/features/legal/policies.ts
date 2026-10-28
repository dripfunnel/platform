import * as WebBrowser from 'expo-web-browser'
import type { MessageKey } from '../../messages'

/** The storefront's policy pages (templates/storefront's `/policies/<kind>/`), in the order the Legal screen lists them; the Shop API serves no policy text (storefront/ARCHITECTURE.md §6). */
export const policies = [
  { kind: 'terms', title: 'legal.terms' },
  { kind: 'privacy', title: 'legal.privacy' },
  { kind: 'returns', title: 'legal.returns' },
  { kind: 'shipping', title: 'legal.shipping' },
  { kind: 'legal', title: 'legal.notice' },
] as const satisfies readonly { kind: string; title: MessageKey }[]

export type PolicyKind = (typeof policies)[number]['kind']

export const policyUrl = (host: string, kind: PolicyKind): string => `https://${host}/policies/${kind}/`

/** Opens a policy in the in-app browser; false when it could not be opened. */
export const openPolicy = async (host: string, kind: PolicyKind): Promise<boolean> => {
  try {
    await WebBrowser.openBrowserAsync(policyUrl(host, kind))
    return true
  } catch {
    return false
  }
}
