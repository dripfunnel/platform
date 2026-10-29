import type { GatewayProvider } from './gateway'

// Every outbound provider header is built here and nowhere else (docs/api/SAAS.md §9.3). Precedence, lowest to highest:
// protocol defaults, then the credential's own headers, then the call's (stream, body). A caller never supplies a header, so
// none can replace an authorization or version header.

/** The beta flag Anthropic requires with a Bearer token from a Claude sign-in. */
export const anthropicOAuthBeta = 'oauth-2025-04-20'
const anthropicVersion = '2023-06-01'

export type HeaderAuth = 'api_key' | 'oauth'

export interface HeaderInput {
  provider: GatewayProvider
  auth: HeaderAuth
  secret: string
  /** The ChatGPT workspace of a ChatGPT sign-in's token; sent only with it. */
  accountId?: string | null
  stream: boolean
  hasBody: boolean
  /** ChatGPT sign-in: the Codex endpoint (oauth/openaiResponses.ts), not api.openai.com. */
  codex?: boolean
}

/** Comma-joined, in order, once each: how Anthropic takes several betas in one header. */
const mergeList = (...lists: readonly (string | undefined)[]): string => [...new Set(lists.flatMap((list) => (list ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '')))].join(',')

/** `set` replaces a name whatever its case, so a name can never be sent twice. */
const apply = (headers: Headers, values: Readonly<Record<string, string>>): void => {
  for (const [name, value] of Object.entries(values)) headers.set(name, value)
}

/** Lower-case names in a plain object, which `fetch` takes and the adapters' tests read. */
export const providerHeaders = ({ provider, auth, secret, accountId, stream, hasBody, codex = false }: HeaderInput): Record<string, string> => {
  const headers = new Headers()
  apply(headers, { accept: stream ? 'text/event-stream' : 'application/json' })
  if (hasBody) apply(headers, { 'content-type': 'application/json' })

  if (provider === 'anthropic') {
    apply(headers, { 'anthropic-version': anthropicVersion })
    if (auth === 'api_key') apply(headers, { 'x-api-key': secret })
    else apply(headers, { authorization: `Bearer ${secret}`, 'anthropic-beta': mergeList(headers.get('anthropic-beta') ?? undefined, anthropicOAuthBeta) })
    return Object.fromEntries(headers)
  }

  apply(headers, { authorization: `Bearer ${secret}` })
  // The Codex endpoint always answers as a stream and names the client (existing sign-in, THIRD-PARTY-ACCESS §2.6).
  if (codex) apply(headers, { accept: 'text/event-stream', originator: 'codex_cli_rs', ...(accountId ? { 'chatgpt-account-id': accountId } : {}) })
  return Object.fromEntries(headers)
}
