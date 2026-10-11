import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { z } from 'zod'
import { inlineHashes, studioCsp } from '@dripfunnel/storefront-core'
import { coreUpgradeNotes, type GuardContext, type UpgradeNote } from '@dripfunnel/storefront-core/guard'
import { isRepoPath, isThemePath } from './paths'
import { Workspace, NotLoaded } from './workspace'

// The sandbox's operations (storefront AI-STUDIO §2 "Container"): only the store's Durable Object talks to it, over the
// container's port; it answers with files and reports and calls nothing itself.
const slotPattern = /^[a-z0-9-]{1,64}$/
const maxJson = 8 * 1024 * 1024
const maxBundle = 64 * 1024 * 1024

const loadFilesSchema = z.strictObject({
  files: z.array(z.strictObject({ path: z.string().refine(isRepoPath), content: z.string().max(1024 * 1024) })).max(2000),
  message: z.string().min(1).max(2000),
})
const changeSchema = z.strictObject({
  files: z.array(z.strictObject({ path: z.string().max(512), content: z.string().max(1024 * 1024).nullable() })).max(500),
  message: z.string().min(1).max(2000),
  context: z.unknown(),
})
const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const upgradeSchema = z.strictObject({
  from: semver,
  to: semver,
  message: z.string().min(1).max(2000),
  baseline: z.array(z.strictObject({ path: z.string().refine(isThemePath), content: z.string().max(1024 * 1024) })).max(500).nullable(),
})
const rebaseSchema = z.strictObject({ onto: z.string().regex(/^[0-9a-f]{40}$/), context: z.unknown() })
const undoSchema = z.strictObject({ commit: z.string().regex(/^[0-9a-f]{40}$/), message: z.string().min(1).max(2000), context: z.unknown() })

// validateChange parses the context with core's own schema before anything reads it (guard/rules.ts).
const asContext = (value: unknown) => value as GuardContext

const frameOrigins = (req: IncomingMessage): { mediaOrigin: string; portalOrigin: string } | null => {
  const media = req.headers['x-df-frame-media']
  const portal = req.headers['x-df-frame-portal']
  return typeof media === 'string' && typeof portal === 'string' ? { mediaOrigin: media, portalOrigin: portal } : null
}

const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json' }

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const read = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > limit) throw new HttpError(413, 'The body is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const json = async <S extends z.ZodType>(req: IncomingMessage, schema: S): Promise<z.infer<S>> => {
  let body: unknown
  try {
    body = JSON.parse((await read(req, maxJson)).toString('utf8'))
  } catch {
    throw new HttpError(400, 'The body is not JSON.')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new HttpError(400, 'The request is not in the shape this operation takes.')
  return parsed.data
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** `notes` are core's own release notes; a test passes its own to exercise codemods core hasn't shipped. */
export type SandboxOptions = { slots: number; workRoot: string; runtimeDir: string; notes?: readonly UpgradeNote[] }

/** One working copy per slot; a container has one slot (its store), and the local stand-in may hold several. */
export const sandboxServer = ({ slots, workRoot, runtimeDir, notes = coreUpgradeNotes }: SandboxOptions): Server => {
  const workspaces = new Map<string, Workspace>()
  const queues = new Map<string, Promise<unknown>>()

  const workspace = (slot: string): Workspace => {
    const found = workspaces.get(slot)
    if (found) return found
    if (workspaces.size >= slots) throw new HttpError(409, 'This sandbox already holds another store.')
    const created = new Workspace(join(workRoot, slot))
    workspaces.set(slot, created)
    return created
  }

  // The Durable Object already runs one change at a time; a slot's operations queue here too, so none overlap.
  const inTurn = <T>(slot: string, work: () => Promise<T>): Promise<T> => {
    const run = (queues.get(slot) ?? Promise.resolve()).then(work, work)
    queues.set(slot, run.catch(() => undefined))
    return run
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://sandbox')
    if (url.pathname === '/health') return send(res, 200, { ok: true })
    const [, root, slot, op, ...rest] = url.pathname.split('/')
    if (root !== 'slots' || !slot || !slotPattern.test(slot) || !op) throw new HttpError(404, 'No such operation.')
    const ws = () => workspace(slot)
    const method = req.method ?? 'GET'

    if (method === 'PUT' && op === 'draft') {
      const type = req.headers['content-type'] ?? ''
      if (type.startsWith('application/x-git-bundle')) {
        const bytes = await read(req, maxBundle)
        return send(res, 200, await inTurn(slot, () => ws().loadBundle(bytes)))
      }
      const body = await json(req, loadFilesSchema)
      return send(res, 200, await inTurn(slot, () => ws().loadFiles(body.files, body.message)))
    }
    if (method === 'POST' && op === 'changes') {
      const body = await json(req, changeSchema)
      return send(res, 200, await inTurn(slot, () => ws().change(body.files, body.message, asContext(body.context))))
    }
    if (method === 'POST' && op === 'undo') {
      const body = await json(req, undoSchema)
      return send(res, 200, await inTurn(slot, () => ws().undo(body.commit, body.message, asContext(body.context))))
    }
    if (method === 'POST' && op === 'upgrade') {
      const body = await json(req, upgradeSchema)
      return send(res, 200, await inTurn(slot, () => ws().upgrade(body, notes)))
    }
    if (method === 'PUT' && op === 'onto') {
      const bytes = await read(req, maxBundle)
      await inTurn(slot, () => ws().receiveOnto(bytes))
      return send(res, 200, { ok: true })
    }
    if (method === 'POST' && op === 'rebase') {
      const body = await json(req, rebaseSchema)
      return send(res, 200, await inTurn(slot, () => ws().rebase(body.onto, asContext(body.context))))
    }
    if (method === 'GET' && op === 'theme') {
      const theme = await inTurn(slot, async () => ({ head: await ws().head(), files: [...(await ws().theme())].map(([path, content]) => ({ path, content })) }))
      return send(res, 200, theme)
    }
    if (method === 'GET' && op === 'bundle') {
      const bytes = await inTurn(slot, () => ws().exportBundle())
      res.writeHead(200, { 'content-type': 'application/x-git-bundle', 'content-length': bytes.byteLength })
      return res.end(bytes)
    }
    if (method === 'GET' && op === 'preview') {
      const files = await inTurn(slot, () => ws().previewFiles())
      return files ? send(res, 200, files) : send(res, 404, { error: 'NO_BUNDLE' })
    }
    if (method === 'GET' && op === 'client') {
      const path = rest.join('/') || 'index.html'
      const bytes = await ws().clientFile(path, runtimeDir)
      if (!bytes) return send(res, 404, { error: 'NOT_FOUND' })
      const headers: Record<string, string | number> = { 'content-type': types[path.split('.').at(-1) ?? ''] ?? 'application/octet-stream', 'content-length': bytes.byteLength }
      const frame = frameOrigins(req)
      // The studio frame's page carries core's own studio CSP (ARCHITECTURE §3.5), from the origins the Durable Object sent.
      if (frame && path.endsWith('.html')) headers['content-security-policy'] = studioCsp(frame, await inlineHashes(bytes.toString('utf8')))
      res.writeHead(200, headers)
      return res.end(bytes)
    }
    throw new HttpError(404, 'No such operation.')
  }

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message })
      if (error instanceof NotLoaded) return send(res, 409, { error: 'NOT_LOADED' })
      if (error instanceof z.ZodError) return send(res, 400, { error: 'BAD_CONTEXT' })
      send(res, 500, { error: 'FAILED' })
    })
  })
}
