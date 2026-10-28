import type postgres from 'postgres'
import { z } from 'zod'
import { readCapped } from '#core/http'
import { logEvent } from '#core/log'
import { verifyWebhookSignature } from '#integrations/github/index'
import { acceptRepoPush, repoPushParams } from '#saas/storefronts/index'

// hooks.<host>/github (#968; storefront LIVE-SHOP.md §4, "A push to `main`"): the GitHub App's push events. A push to a
// store repo's `main` is queued for its publish; every other event is answered and ignored.
export const githubHookPath = '/github'

// A push event lists its commits; one far larger than this isn't a theme's push.
const maxBodyBytes = 1024 * 1024

const pushSchema = z
  .object({
    ref: z.string().max(300),
    after: z.string(),
    deleted: z.boolean(),
    repository: z.object({ id: z.number().int().positive(), owner: z.object({ login: z.string().max(39) }).loose() }).loose(),
    sender: z.object({ login: z.string() }).loose(),
  })
  .loose()

export interface GitHubHookDeps {
  sql: postgres.Sql
  secret: string
  org: string
}

export const handleGitHubHook = async (request: Request, deps: GitHubHookDeps): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const raw = await readCapped(request, maxBodyBytes)
  if (!raw.ok) return new Response(null, { status: 413 })
  const body = new Uint8Array(raw.bytes)
  if (!(await verifyWebhookSignature(body, request.headers.get('x-hub-signature-256'), deps.secret))) return new Response(null, { status: 401 })
  const received = (code: string) => {
    logEvent({ event: 'github_push', api: 'hooks', status: 200, code })
    return Response.json({ received: true })
  }
  if (request.headers.get('x-github-event') !== 'push') return received('other_event')
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return new Response(null, { status: 400 })
  }
  const event = pushSchema.safeParse(json)
  if (!event.success) return new Response(null, { status: 400 })
  const { ref, after, deleted, repository, sender } = event.data
  if (ref !== 'refs/heads/main' || deleted || repository.owner.login.toLowerCase() !== deps.org.toLowerCase()) return received('ignored')
  const push = repoPushParams.safeParse({ repoId: String(repository.id), commit: after, pusher: sender.login })
  if (!push.success) return new Response(null, { status: 400 })
  return received(await acceptRepoPush(deps.sql, push.data))
}
