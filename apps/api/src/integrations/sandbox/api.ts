import { z } from 'zod'

// The studio sandbox's operations (apps/sandbox/src/server.ts; storefront AI-STUDIO §2), as the store's Durable Object
// calls them over the container's port. Its answers are read with zod: the container runs AI-written code.

/** The container is gone or not answering: the Durable Object restarts it from the saved draft (AI-STUDIO §7). */
export class SandboxDown extends Error {
  override name = 'SandboxDown'
}

/** The sandbox refused the call itself (not the change): a fault in what the Durable Object sent. */
export class SandboxRefused extends Error {
  override name = 'SandboxRefused'
}

export type FileChange = { path: string; content: string | null }
export type GuardContext = {
  locales: string[]
  usedPaths: string[]
  mediaIds: string[]
  brand: { name: string; tagline: string | null; email: string | null; phone: string | null; address: string[]; socialLinks: string[] }
}

const problemSchema = z.object({ step: z.enum(['validator', 'typecheck', 'bundle', 'budget']), file: z.string().nullable(), line: z.number().int().nullable(), rule: z.string().max(100), message: z.string().max(2000) })
const bundleSchema = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/), entry: z.string(), files: z.array(z.object({ path: z.string(), bytes: z.number().int() })) })
const changeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), changed: z.boolean(), commit: z.string().regex(/^[0-9a-f]{40}$/), bundle: bundleSchema }),
  z.object({ ok: z.literal(false), problems: z.array(problemSchema).max(500) }),
])
const loadedSchema = z.object({ head: z.string().regex(/^[0-9a-f]{40}$/), bundle: bundleSchema.nullable(), problems: z.array(problemSchema).max(500) })
const themeSchema = z.object({ head: z.string().regex(/^[0-9a-f]{40}$/), files: z.array(z.object({ path: z.string(), content: z.string() })).max(2000) })
const upgradedSchema = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  files: z.array(z.object({ path: z.string().max(512), content: z.string().nullable() })).max(1000),
  notes: z.array(z.object({ version: z.string(), kind: z.enum(['major', 'minor', 'patch']), notes: z.string().max(8000) })).max(100),
})
const previewSchema = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/), files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), base64: z.string() })).max(500) })

export type GateProblem = z.infer<typeof problemSchema>
export type ClientBundle = z.infer<typeof bundleSchema>
export type ChangeResult = z.infer<typeof changeSchema>
export type Loaded = z.infer<typeof loadedSchema>
export type PreviewFiles = z.infer<typeof previewSchema>
export type Upgraded = z.infer<typeof upgradedSchema>
/** The upgrade bot's request (storefront ARCHITECTURE §7.1): codemods from `from` to `to`, or the baseline theme's files. */
export type UpgradeRequest = { from: string; to: string; message: string; baseline: { path: string; content: string }[] | null }

/** How a request reaches the container: `ctx.container.getTcpPort(port).fetch` on Cloudflare, plain fetch locally. */
export type SandboxFetch = (request: Request) => Promise<Response>

// The gate's typecheck and bundle take seconds on ¼ vCPU (AI-STUDIO §9); a call past this is a container in trouble.
const timeoutMs = 120_000

export const sandboxClient = (send: SandboxFetch, slot: string) => {
  const call = async (method: string, path: string, body?: BodyInit, type = 'application/json'): Promise<Response> => {
    let response: Response
    try {
      response = await send(new Request(`http://sandbox/slots/${slot}/${path}`, { method, ...(body === undefined ? {} : { body, headers: { 'content-type': type } }), signal: AbortSignal.timeout(timeoutMs) }))
    } catch {
      throw new SandboxDown('The sandbox did not answer.')
    }
    if (response.status >= 500) throw new SandboxDown(`The sandbox failed (${response.status}).`)
    if (!response.ok) {
      // The sandbox's own fixed words (apps/sandbox/src/server.ts), never the theme's.
      const said = z.object({ error: z.string().max(200) }).safeParse(await response.json().catch(() => null))
      throw new SandboxRefused(`The sandbox refused ${method} ${path.split('/')[0] ?? ''} (${response.status}${said.success ? `: ${said.data.error}` : ''}).`)
    }
    return response
  }
  const json = async <S extends z.ZodType>(response: Response, schema: S): Promise<z.infer<S>> => {
    const parsed = schema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new SandboxDown('The sandbox answered in a shape it never sends.')
    return parsed.data
  }
  return {
    loadBundle: async (bytes: ArrayBuffer): Promise<Loaded> => json(await call('PUT', 'draft', bytes, 'application/x-git-bundle'), loadedSchema),
    loadFiles: async (files: readonly { path: string; content: string }[], message: string): Promise<Loaded> => json(await call('PUT', 'draft', JSON.stringify({ files, message })), loadedSchema),
    theme: async () => json(await call('GET', 'theme'), themeSchema),
    change: async (files: readonly FileChange[], message: string, context: GuardContext): Promise<ChangeResult> => json(await call('POST', 'changes', JSON.stringify({ files, message, context })), changeSchema),
    undo: async (commit: string, message: string, context: GuardContext): Promise<ChangeResult> => json(await call('POST', 'undo', JSON.stringify({ commit, message, context })), changeSchema),
    upgrade: async (request: UpgradeRequest): Promise<Upgraded> => json(await call('POST', 'upgrade', JSON.stringify(request)), upgradedSchema),
    /** AI-STUDIO §6 step 2: the draft onto the upgrade's commit, whose bundle goes first. */
    rebase: async (onto: { commit: string; bundle: ArrayBuffer }, context: GuardContext): Promise<ChangeResult> => {
      await call('PUT', 'onto', onto.bundle, 'application/x-git-bundle')
      return json(await call('POST', 'rebase', JSON.stringify({ onto: onto.commit, context })), changeSchema)
    },
    exportBundle: async (): Promise<ArrayBuffer> => (await call('GET', 'bundle')).arrayBuffer(),
    previewFiles: async (): Promise<PreviewFiles> => json(await call('GET', 'preview'), previewSchema),
    /** A frame file as the container serves it, its page with core's studio CSP for these origins; a 404 is passed through. */
    client: async (path: string, frame: { media: string; portal: string }): Promise<Response> => {
      try {
        const headers = { 'x-df-frame-media': frame.media, 'x-df-frame-portal': frame.portal }
        return await send(new Request(`http://sandbox/slots/${slot}/client/${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) }))
      } catch {
        throw new SandboxDown('The sandbox did not answer.')
      }
    },
  }
}

export type SandboxClient = ReturnType<typeof sandboxClient>
