import { defaultTimeoutMs } from './client'
import { ApiError } from './errors'

export type RestOptions = {
  domain: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** A JSON answer of a refused sign-in route: `{ ok: false, code, ...facts }` (apps/api src/apis/store/authHttp.ts). */
type Answer = { ok?: boolean; code?: string } & Record<string, unknown>

// The sign-in routes are plain POSTs (ACCESS.md §4), not GraphQL. With no `Origin` header and no cookie the API
// answers with the session in the body, so cookies are never sent or kept. `token` is the bearer, when there is one.
export const postJson = async <T extends Record<string, unknown>>(
  { domain, timeoutMs = defaultTimeoutMs, fetchImpl = fetch }: RestOptions,
  path: string,
  body: Record<string, unknown>,
  token: string | null = null,
): Promise<T> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  let answer: Answer
  try {
    const response = await fetchImpl(`https://${domain}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: abort.signal,
      credentials: 'omit',
    })
    answer = (await response.json()) as Answer
  } catch {
    throw new ApiError('NO_RESPONSE', 'The API did not answer.')
  } finally {
    clearTimeout(timer)
  }
  if (answer.ok === true) return answer as T
  const details = Object.fromEntries(Object.entries(answer).filter(([name]) => name !== 'ok' && name !== 'code'))
  throw new ApiError(typeof answer.code === 'string' ? answer.code : undefined, 'The API refused the request.', details)
}

/** Ends the session on the server. Best effort: the phone forgets it either way, so a failure changes nothing. */
export const postSignOut = async ({ domain, timeoutMs = defaultTimeoutMs, fetchImpl = fetch }: RestOptions, token: string): Promise<void> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    await fetchImpl(`https://${domain}/api/auth/sign-out`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: abort.signal, credentials: 'omit', redirect: 'manual' })
  } catch {
    // Nothing to do: see above.
  } finally {
    clearTimeout(timer)
  }
}
