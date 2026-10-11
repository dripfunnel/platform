import { z } from 'zod'
import { json, readCapped } from '#core/http'
import { logEvent } from '#core/log'
import { BuildRefused, BuildUnavailable, gateReport, issueCredentials, reportBuild, startBuild, type BuildDeps } from '#saas/builds/index'

// `hooks.<host>/builds/*`: a store repo's locked workflow, and nothing else, calls these (storefront LIVE-SHOP.md §4
// steps 5–8). No browser, no cookie: a GitHub OIDC token in `Authorization` and the build id in the body.

export const buildsPrefix = '/builds/'

const bodyLimit = 64 * 1024
const buildOnly = z.strictObject({ build: z.guid() })

// Every refusal is this one answer, whatever its cause, which goes to the technical log only (LIVE-SHOP §9).
const refused = () => json(403, { error: 'refused' })
const noStore = (response: Response) => {
  response.headers.set('cache-control', 'no-store')
  return response
}

type Step = (deps: BuildDeps, token: string, body: unknown) => Promise<unknown>

const steps: Record<string, Step> = {
  start: (deps, token, body) => startBuild(deps, token, buildOnly.parse(body).build),
  report: (deps, token, body) => reportBuild(deps, token, gateReport.parse(body)),
  credentials: (deps, token, body) => issueCredentials(deps, token, buildOnly.parse(body).build),
}

const bearer = (request: Request): string | null => /^Bearer ([A-Za-z0-9_\-.]{20,8192})$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? null

/** The body as JSON, or null when it is too long or isn't JSON; the step's schema then refuses it. */
const jsonBody = async (request: Request): Promise<unknown> => {
  const raw = await readCapped(request, bodyLimit)
  if (!raw.ok) return null
  try {
    return JSON.parse(new TextDecoder().decode(raw.bytes)) as unknown
  } catch {
    return null
  }
}

export const handleBuildCall = async (request: Request, deps: BuildDeps, allow: (key: string) => Promise<boolean>): Promise<Response> => {
  const name = new URL(request.url).pathname.slice(buildsPrefix.length)
  const step = Object.hasOwn(steps, name) ? steps[name] : undefined
  if (!step || request.method !== 'POST') return new Response(null, { status: 404 })
  const log = (status: number, code: string) => logEvent({ event: 'build_call', api: 'hooks', status, code: `${name}:${code}` })
  if (!(await allow(`build:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`))) {
    log(429, 'rate_limited')
    return json(429, { error: 'rate_limited' })
  }
  const token = bearer(request)
  const body = await jsonBody(request)
  if (!token) {
    log(403, 'refused:no_token')
    return refused()
  }
  try {
    const answer = await step(deps, token, body)
    log(200, 'accepted')
    return noStore(json(200, answer))
  } catch (error) {
    if (error instanceof BuildUnavailable) {
      log(503, `unavailable:${error.message}`)
      return noStore(json(503, { error: 'unavailable' }))
    }
    if (error instanceof BuildRefused) {
      log(403, `refused:${error.reason}`)
      return refused()
    }
    if (error instanceof z.ZodError) {
      log(403, 'refused:bad_request')
      return refused()
    }
    throw error
  }
}
