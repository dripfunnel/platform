import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'

// A store repo's build proves which repo, workflow, branch, event and run it is with GitHub's OIDC token (storefront
// LIVE-SHOP.md §9; THIRD-PARTY-ACCESS.md §2.3). No secret: the signature is checked against GitHub's published keys.

export const actionsIssuer = 'https://token.actions.githubusercontent.com'
export const lockedWorkflowFile = '.github/workflows/build.yml'
export const lockedBranch = 'refs/heads/main'

/** Why a token was refused, for the technical log only: every caller gets the same answer. */
export type TokenRefusal = 'bad_token' | 'keys_unavailable' | 'wrong_repo' | 'wrong_workflow' | 'wrong_branch' | 'wrong_event'

export class TokenRefused extends Error {
  override name = 'TokenRefused'
  constructor(readonly reason: TokenRefusal) {
    super(reason)
  }
}

const claimsSchema = z.object({
  repository_id: z.string().regex(/^[1-9]\d{0,19}$/),
  job_workflow_ref: z.string().max(400),
  ref: z.string().max(300),
  event_name: z.string().max(60),
  run_id: z.string().regex(/^[1-9]\d{0,19}$/),
})

export interface ActionsRun {
  repositoryId: string
  jobWorkflowRef: string
  ref: string
  eventName: string
  runId: string
}

const keysTimeoutMs = 5_000

/** GitHub's key set, cached by jose and fetched again when a token names a key id it doesn't hold (after a 30 s cooldown). */
export const actionsKeys = (fetchImpl?: typeof fetch): JWTVerifyGetKey =>
  createRemoteJWKSet(new URL(`${actionsIssuer}/.well-known/jwks`), {
    timeoutDuration: keysTimeoutMs,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    ...(fetchImpl ? { [customFetch]: fetchImpl } : {}),
  })

// GitHub's key set didn't arrive (timeout, not 200, not a key set, no answer): try again later, not a forged token.
const keysFailure = (error: unknown): boolean =>
  error instanceof TypeError || (error instanceof Error && ['ERR_JWKS_TIMEOUT', 'ERR_JOSE_GENERIC', 'ERR_JWKS_INVALID'].includes((error as { code?: string }).code ?? ''))

/** The signature, issuer, audience and expiry; the run's own claims come back for `acceptRun`. */
export const verifyActionsToken = async (token: string, keys: JWTVerifyGetKey, audience: string, now: Date): Promise<ActionsRun> => {
  let payload
  try {
    // Pinned: GitHub signs with RS256, and jose checks `exp` only when it's required.
    ;({ payload } = await jwtVerify(token, keys, { issuer: actionsIssuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat'], currentDate: now, clockTolerance: 30 }))
  } catch (error) {
    throw new TokenRefused(keysFailure(error) ? 'keys_unavailable' : 'bad_token')
  }
  const claims = claimsSchema.safeParse(payload)
  if (!claims.success) throw new TokenRefused('bad_token')
  const c = claims.data
  return { repositoryId: c.repository_id, jobWorkflowRef: c.job_workflow_ref, ref: c.ref, eventName: c.event_name, runId: c.run_id }
}

export interface StoreRepo {
  org: string
  repo: string
  repoId: string
}

/** The store's own repo, its locked workflow on `main`, started by the platform's `workflow_dispatch` (LIVE-SHOP §9). */
export const acceptRun = (run: ActionsRun, store: StoreRepo): TokenRefusal | null => {
  if (run.repositoryId !== store.repoId) return 'wrong_repo'
  const at = run.jobWorkflowRef.lastIndexOf('@')
  // GitHub compares owner and repo names without case; the id above already pinned the repo itself.
  if (at < 0 || run.jobWorkflowRef.slice(0, at).toLowerCase() !== `${store.org}/${store.repo}/${lockedWorkflowFile}`.toLowerCase()) return 'wrong_workflow'
  if (run.jobWorkflowRef.slice(at + 1) !== lockedBranch || run.ref !== lockedBranch) return 'wrong_branch'
  if (run.eventName !== 'workflow_dispatch') return 'wrong_event'
  return null
}
