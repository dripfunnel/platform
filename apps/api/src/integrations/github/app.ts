import { SignJWT } from 'jose'

// The DripFunnel Provisioning GitHub App (THIRD-PARTY-ACCESS.md §2.3): a JWT signed with WebCrypto, then a short-lived
// installation token per session, limited to the App's five permissions. No token is ever logged, kept or returned.

export const githubApi = 'https://api.github.com'

/** Exactly what THIRD-PARTY-ACCESS §2.3 grants; each token asks for these and no more. */
export const appPermissions = { administration: 'write', contents: 'write', workflows: 'write', actions: 'write', metadata: 'read' } as const

/** GitHub didn't answer, answered 5xx, throttled us, or refused our credentials: nothing to fix in the request, try later. */
export class GitHubUnavailable extends Error {
  override name = 'GitHubUnavailable'
}

/** GitHubUnavailable's words when no answer came at all, so a caller can tell it from a 5xx. */
export const noAnswer = 'GitHub did not answer'

/** GitHub refused the request itself (4xx); retrying it unchanged gives the same answer. */
export class GitHubRefused extends Error {
  override name = 'GitHubRefused'
  constructor(readonly status: number) {
    super(`GitHub answered ${status}`)
  }
}

export interface GitHubAppOptions {
  appId: string
  installationId: string
  /** The App's PEM key, PKCS#1 as GitHub issues it or PKCS#8. */
  privateKey: string
  fetchImpl?: typeof fetch
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export interface Answer {
  status: number
  body: unknown
}

/** One installation token's worth of calls; `allow` names the 4xx statuses the caller reads instead of a refusal. */
export type GitHubCall = (method: Method, path: string, body?: unknown, allow?: readonly number[]) => Promise<Answer>

export interface GitHubApp {
  session: () => GitHubCall
}

const timeoutMs = 10_000
const attempts = 3
const baseDelayMs = 500
const maxRetryAfterMs = 10_000

const der = (bytes: number[]): number[] => {
  const n = bytes.length
  if (n < 0x80) return [n]
  const out: number[] = []
  for (let rest = n; rest > 0; rest >>= 8) out.unshift(rest & 0xff)
  return [0x80 | out.length, ...out]
}

const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]

/** PKCS#1 wrapped as PKCS#8 (RFC 5208), the only RSA private key format WebCrypto imports. */
const pkcs8Of = (pkcs1: Uint8Array): Uint8Array<ArrayBuffer> => {
  const octets = [0x04, ...der([...pkcs1]), ...pkcs1]
  const body = [0x02, 0x01, 0x00, ...rsaAlgorithm, ...octets]
  return new Uint8Array([0x30, ...der(body), ...body])
}

export const importAppKey = async (pem: string): Promise<CryptoKey> => {
  const pkcs1 = pem.includes('BEGIN RSA PRIVATE KEY')
  const base64 = pem.replace(/-----(BEGIN|END) (RSA )?PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', pkcs1 ? pkcs8Of(raw) : raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

const retryable = (response: Response): boolean =>
  response.status >= 500 || response.status === 429 || response.status === 401 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))

const retryAfter = (response: Response | null, attempt: number): number => {
  const seconds = Number(response?.headers.get('retry-after') ?? NaN)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, maxRetryAfterMs) : baseDelayMs * 4 ** attempt
}

export const createGitHubApp = ({ appId, installationId, privateKey, fetchImpl = fetch, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: GitHubAppOptions): GitHubApp => {
  let key: Promise<CryptoKey> | undefined

  /** `authorize(true)` after a 401: an installation token can expire or be revoked mid-session, so the retry gets a fresh one. */
  const send = async (method: Method, path: string, authorize: (renew: boolean) => Promise<string>, body: unknown, allow: readonly number[]): Promise<Answer> => {
    let renew = false
    for (let attempt = 0; ; attempt++) {
      const authorization = await authorize(renew)
      let response: Response | null
      try {
        response = await fetchImpl(`${githubApi}${path}`, {
          method,
          headers: { authorization, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'dripfunnel-provisioning', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? null : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        response = null
      }
      if (response && !retryable(response)) {
        if (response.ok || allow.includes(response.status)) return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) }
        throw new GitHubRefused(response.status)
      }
      renew = response?.status === 401
      if (attempt + 1 >= attempts) throw new GitHubUnavailable(response ? `GitHub answered ${response.status}` : noAnswer)
      await sleep(retryAfter(response, attempt))
    }
  }

  const appJwt = async (): Promise<string> => {
    key ??= importAppKey(privateKey)
    const at = Math.floor(now().getTime() / 1000)
    // A minute back for clock drift; GitHub refuses one that lives over ten minutes.
    return new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(appId).setIssuedAt(at - 60).setExpirationTime(at + 540).sign(await key)
  }

  const installationToken = async (): Promise<string> => {
    const answer = await send('POST', `/app/installations/${installationId}/access_tokens`, async () => `Bearer ${await appJwt()}`, { permissions: appPermissions }, [])
    const token = (answer.body as { token?: unknown } | null)?.token
    if (typeof token !== 'string' || token.length === 0) throw new GitHubUnavailable('GitHub answered without a token')
    return token
  }

  return {
    session: () => {
      let token: Promise<string> | undefined
      const authorize = async (renew: boolean) => {
        if (renew) token = undefined
        token ??= installationToken()
        // A failed exchange isn't kept: the next call asks again.
        const current = await token.catch((error: unknown) => {
          token = undefined
          throw error
        })
        return `Bearer ${current}`
      }
      return (method, path, body, allow = []) => send(method, path, authorize, body, allow)
    },
  }
}
