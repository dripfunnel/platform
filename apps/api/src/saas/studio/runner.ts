import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { storeContentPaths } from '#engine/modules/content/index'
import { insertAiRun, moveDraft, selectGuardContext, selectStudioStart, type AiRunOutcome } from '#db/scoped/studio'
import { SandboxDown, sandboxClient, type ChangeResult, type ClientBundle, type GateProblem, type GuardContext, type Loaded, type SandboxClient, type SandboxHost } from '#integrations/sandbox/index'
import { draftBundle, guardContextFor, previewFolder, sourceBundle, templateFiles, type SitesBucket } from '../storefronts/index'
import { maxRepairs, type DesignModel, type Proposal, type ProposalSummary } from './model'
import { pageTexts, withText } from './texts'
import { templateChange } from './template'

// One store's studio (storefront AI-STUDIO.md §3–§7): the Durable Object holds one of these, and runs one change at a
// time through it. Every outside call is here or in the Worker; the container gets files and gives files back.

export interface DraftsBucket {
  get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>
  put: (key: string, value: ArrayBuffer) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
}

/** At the container limit a studio waits its turn (AI-STUDIO §7). */
export interface StudioCapacity {
  acquire: () => Promise<{ granted: true } | { granted: false; place: number }>
  release: () => Promise<void>
}

export interface StudioDeps {
  /** A connection for one piece of work: the Durable Object opens one per call, as the Worker does per request. */
  db: <T>(work: (sql: postgres.Sql) => Promise<T>) => Promise<T>
  storeId: string
  /** The sandbox for the store's core version: its container, or the local stand-in. */
  host: (coreVersion: string) => Promise<SandboxHost>
  drafts: DraftsBucket
  sites: SitesBucket
  capacity: StudioCapacity
  now: () => Date
  newId: () => string
  /** Each new client bundle, for the frame's hot reload (AI-STUDIO §4 step 5). */
  onBundle: (bundle: ClientBundle) => void
}

export class StudioQueued extends Error {
  override name = 'StudioQueued'
  constructor(readonly place: number) {
    super('The studio is waiting for room.')
  }
}

/** The store has no storefront to design yet (no template chosen), or the sandbox failed twice in a row. */
export class StudioUnavailable extends Error {
  override name = 'StudioUnavailable'
}

export type ChangeOutcome =
  | { outcome: 'changed'; commit: string; previewRef: string; repairs: number; runId: string | null; summary?: ProposalSummary | null }
  | { outcome: 'unchanged'; commit: string; repairs: number; runId: string | null; summary?: ProposalSummary | null }
  | { outcome: 'refused'; problems: GateProblem[]; repairs: number; runId: string | null }

export type ChangeRequest = { request: string; userId: string; billedTo: 'plan' | 'own_key'; model: DesignModel }

const routesSchema = z.object({ custom: z.record(z.string(), z.string()).optional() })

const customPaths = (theme: ReadonlyMap<string, string>): string[] => {
  try {
    return Object.keys(routesSchema.parse(JSON.parse(theme.get('routes.json') ?? '{}')).custom ?? {}).sort()
  } catch {
    return []
  }
}

const decode = (base64: string): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return bytes.buffer
}

const contentTypes: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' }

/** One ask of the model and what the gate said; `result` is null when the sandbox failed before it could say. */
type Attempt = { proposal: Proposal; ms: number; result: ChangeResult | null }

export class StudioRunner {
  private host: SandboxHost | null = null
  private client: SandboxClient | null = null
  private start: { template: string; coreVersion: string } | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private waiting = 0

  constructor(private readonly deps: StudioDeps) {}

  /** Changes queued or running; a second request for the store waits behind the first (AI-STUDIO §4 step 1). */
  get pending(): number {
    return this.waiting
  }

  get loaded(): boolean {
    return this.client !== null && (this.host?.running() ?? false)
  }

  /** Starts the store's sandbox from its saved draft, or says where it stands in the queue. */
  open(): Promise<ClientBundle | null> {
    return this.inTurn(async () => (await this.ensureLoaded()).bundle)
  }

  change(input: ChangeRequest): Promise<ChangeOutcome> {
    return this.inTurn(() => this.runChange(input))
  }

  /** "Undo this change" (AI-STUDIO §5): a new change, through the same gate, saved and previewed the same way. */
  undo(commit: string, userId: string): Promise<ChangeOutcome> {
    return this.inTurn(() => this.commitStep((client, context) => client.undo(commit, `Undo ${commit.slice(0, 12)}`, context), userId))
  }

  /** "Change template" (SAAS §9.2): the template's theme as one change to the draft, through the same gate; nothing is pushed. */
  useTemplate(template: string, keep: boolean, userId: string): Promise<ChangeOutcome> {
    return this.inTurn(async () => {
      await this.ensureLoaded()
      if (!this.start) throw new StudioUnavailable('Nothing is loaded to change.')
      const { theme } = await templateFiles(this.deps.sites, this.start.coreVersion, template)
      const files = templateChange(await this.themeNow(), theme, (await this.guardContext()).locales, keep)
      return this.commitStep((client, context) => client.change(files, `Use the ${template} template`, context), userId, template)
    })
  }

  /** Edit text: the page's words in one language, as the draft holds them (FIRST-RELEASE §14). */
  texts(page: string, locale: string): Promise<{ key: string; text: string }[]> {
    return this.inTurn(async () => pageTexts(await this.themeNow(), page, locale))
  }

  /** One string of the draft's words, through the gate like any change, with no model call (SAAS §9.2 guardrail 1). */
  editText(locale: string, key: string, text: string, userId: string): Promise<ChangeOutcome | { outcome: 'missing' }> {
    return this.inTurn(async () => {
      const file = withText(await this.themeNow(), locale, key, text)
      if (!file) return { outcome: 'missing' as const }
      return this.commitStep((client, context) => client.change([file], `Edit text ${locale} ${key}`, context), userId)
    })
  }

  /**
   * Discard (AI-STUDIO §5), or the draft after Go back: `forget` drops the draft's row first, then its bundle goes and the
   * sandbox unloads, so the next open starts from the live build's source at the live commit. In turn, so no change interleaves.
   */
  reset(forget: () => Promise<void>): Promise<void> {
    return this.inTurn(async () => {
      await forget()
      await this.deps.drafts.delete(draftBundle(this.deps.storeId))
      await this.unload()
    })
  }

  /** A file of the frame's current bundle, or null while the sandbox isn't loaded (the frame shows the preview). */
  async frameFile(path: string, frame: { media: string; portal: string }): Promise<Response | null> {
    if (!this.loaded || !this.client) return null
    return this.client.client(path, frame)
  }

  /** Idle stop (AI-STUDIO §7): the draft is already saved, so the next request starts again from it. */
  async stop(): Promise<void> {
    await this.inTurn(() => this.unload())
  }

  private async unload(): Promise<void> {
    const host = this.host
    this.client = null
    this.host = null
    this.start = null
    if (host) await host.stop()
    await this.deps.capacity.release()
  }

  private system<T>(work: Parameters<typeof withSystemScope<T>>[1]): Promise<T> {
    return this.deps.db((sql) => withSystemScope(sql, work))
  }

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    this.waiting += 1
    const run = this.tail.then(work, work).finally(() => {
      this.waiting -= 1
    })
    this.tail = run.catch(() => undefined)
    return run
  }

  private async ensureLoaded(): Promise<{ client: SandboxClient; bundle: ClientBundle | null }> {
    if (this.client && this.host?.running()) return { client: this.client, bundle: null }
    const { storeId } = this.deps
    const row = await this.system((tx) => selectStudioStart(tx, storeId))
    const template = row?.template ?? row?.live_template ?? row?.storefront_template ?? null
    const coreVersion = row?.core_version ?? row?.live_core_version ?? row?.store_core_version ?? null
    if (!row || !template || !coreVersion) throw new StudioUnavailable('The store has no storefront to design yet.')
    const grant = await this.deps.capacity.acquire()
    if (!grant.granted) throw new StudioQueued(grant.place)
    const host = await this.deps.host(coreVersion).catch(async (error: unknown) => {
      await this.deps.capacity.release()
      throw error
    })
    let loaded: Loaded
    const client = sandboxClient(host.send, storeId)
    try {
      await host.start()
      // AI-STUDIO §3 step 4: the draft only while its row exists, else the live build's source at the live commit.
      const draft = row.head_commit ? await this.deps.drafts.get(draftBundle(storeId)) : null
      const live = !draft && row.live_build_id ? await this.deps.drafts.get(sourceBundle(storeId, row.live_build_id)) : null
      if (!draft && row.live_build_id && !live) throw new StudioUnavailable('The live build’s source is missing.')
      const saved = draft ?? live
      loaded = saved
        ? await client.loadBundle(await saved.arrayBuffer(), draft ? null : row.live_commit)
        : await (async () => {
            const { skeleton, theme } = await templateFiles(this.deps.sites, coreVersion, template)
            return client.loadFiles([...skeleton, ...theme], `Start from the ${template} template`)
          })()
    } catch (error) {
      // A container this object can't use must not keep running, nor hold a place the next studio needs.
      await host.stop().catch(() => undefined)
      await this.deps.capacity.release()
      throw error
    }
    this.host = host
    this.client = client
    this.start = { template, coreVersion }
    if (loaded.bundle) this.deps.onBundle(loaded.bundle)
    return { client, bundle: loaded.bundle }
  }

  /**
   * Crash recovery (AI-STUDIO §7): a sandbox that stops answering mid-change is started again from the last saved draft
   * and the step is tried once more; nothing is saved until a step finished, so the draft is never half a change.
   */
  private async recovering<T>(step: (client: SandboxClient) => Promise<T>): Promise<T> {
    try {
      return await step((await this.ensureLoaded()).client)
    } catch (error) {
      if (!(error instanceof SandboxDown)) throw error
      const host = this.host
      this.client = null
      this.host = null
      await host?.stop().catch(() => undefined)
      try {
        return await step((await this.ensureLoaded()).client)
      } catch (again) {
        if (again instanceof SandboxDown) throw new StudioUnavailable('The sandbox stopped twice.')
        throw again
      }
    }
  }

  private async runChange(input: ChangeRequest): Promise<ChangeOutcome> {
    const context = await this.guardContext()
    const theme = await this.themeNow()
    const attempts: Attempt[] = []
    let problems: GateProblem[] = []
    let saved: Awaited<ReturnType<StudioRunner['collect']>> | null = null
    try {
      for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
        const proposal = await input.model.propose({ request: input.request, theme: [...theme].map(([path, content]) => ({ path, content })), problems })
        const startedAt = this.deps.now().getTime()
        const made: Attempt = { proposal, ms: 0, result: null }
        attempts.push(made)
        const done = await this.recovering(async (client) => {
          const result = await client.change(proposal.files, input.request, context)
          return { result, saved: result.ok && result.changed ? await this.collect(client) : null }
        }).finally(() => {
          made.ms = this.deps.now().getTime() - startedAt
        })
        made.result = done.result
        if (done.result.ok) {
          saved = done.saved
          break
        }
        problems = done.result.problems
      }
    } catch (error) {
      // The asks already made cost tokens and repairs are the platform's (SAAS §9.2), so they're metered as `failed`.
      await this.record(input, attempts, 'failed')
      throw error
    }
    const last = attempts.at(-1)?.result
    const repairs = attempts.length - 1
    if (!last?.ok) {
      const runId = await this.record(input, attempts, 'refused')
      return { outcome: 'refused', problems, repairs, runId }
    }
    const after = new Map(theme)
    for (const f of attempts.at(-1)?.proposal.files ?? []) {
      if (f.content === null) after.delete(f.path)
      else after.set(f.path, f.content)
    }
    let previewRef: string | null
    try {
      previewRef = saved ? await this.save(saved, last, input.userId, after) : null
    } catch (error) {
      // A pass that couldn't be saved changed nothing the merchant can see, but its asks were still spent.
      await this.record(input, attempts, 'failed')
      throw error
    }
    const runId = await this.record(input, attempts, previewRef ? 'changed' : 'unchanged')
    const summary = attempts.at(-1)?.proposal.summary ?? null
    return previewRef ? { outcome: 'changed', commit: last.commit, previewRef, repairs, runId, summary } : { outcome: 'unchanged', commit: last.commit, repairs, runId, summary }
  }

  /** One step of the sandbox without the model (undo, a template, edited words): saved and previewed when it changed something. */
  private async commitStep(step: (client: SandboxClient, context: GuardContext) => Promise<ChangeResult>, userId: string, template?: string): Promise<ChangeOutcome> {
    const context = await this.guardContext()
    const done = await this.recovering(async (client) => {
      const result = await step(client, context)
      return { result, saved: result.ok && result.changed ? await this.collect(client) : null }
    })
    const { result } = done
    if (!result.ok) return { outcome: 'refused', problems: result.problems, repairs: 0, runId: null }
    if (!done.saved) return { outcome: 'unchanged', commit: result.commit, repairs: 0, runId: null }
    const previewRef = await this.save(done.saved, result, userId, await this.themeNow(), template)
    return { outcome: 'changed', commit: result.commit, previewRef, repairs: 0, runId: null }
  }

  /** What an accepted change leaves to save: the repo as a git bundle and the gate's bundle for the preview. */
  private async collect(client: SandboxClient) {
    return { bundle: await client.exportBundle(), preview: await client.previewFiles() }
  }

  /** AI-STUDIO §4 steps 5–7: the draft bundle, then the preview folder, then the pointers, then the frame's reload. */
  private async save(saved: Awaited<ReturnType<StudioRunner['collect']>>, result: Extract<ChangeResult, { ok: true }>, userId: string, theme: ReadonlyMap<string, string>, template?: string): Promise<string> {
    if (!this.start) throw new StudioUnavailable('Nothing is loaded to save.')
    if (template) this.start = { ...this.start, template }
    const { storeId } = this.deps
    await this.deps.drafts.put(draftBundle(storeId), saved.bundle)
    const ref = this.deps.newId()
    const folder = previewFolder(storeId, ref)
    for (const f of saved.preview.files) {
      const type = contentTypes[f.path.split('.').at(-1) ?? '']
      await this.deps.sites.put(`${folder}${f.path}`, decode(f.base64), { sha256: f.sha256, ...(type ? { httpMetadata: { contentType: type } } : {}) })
    }
    const start = this.start
    await this.system((tx) =>
      moveDraft(tx, { storeId, head: result.commit, template: start.template, coreVersion: start.coreVersion, previewRef: ref, userId, at: this.deps.now(), customPaths: customPaths(theme) }),
    )
    this.deps.onBundle(result.bundle)
    return ref
  }

  /** SAAS §9.2 metering: the merchant's ask on its plan or key, each repair on the platform, every one with its sandbox time. */
  private async record(input: ChangeRequest, attempts: readonly Attempt[], outcome: AiRunOutcome): Promise<string | null> {
    const [first, ...repairs] = attempts
    if (!first) return null
    const base = { storeId: this.deps.storeId, requestedBy: input.userId, prompt: input.request.slice(0, 4000) }
    const run = (a: Attempt) => ({ model: a.proposal.model, tokensIn: a.proposal.tokensIn, tokensOut: a.proposal.tokensOut, costAmount: a.proposal.costAmount, costCurrency: a.proposal.costCurrency, sandboxMs: Math.max(0, a.ms) })
    return this.system(async (tx) => {
      const id = await insertAiRun(tx, { ...base, ...run(first), kind: 'design', billedTo: input.billedTo, repairAttempts: repairs.length, parentRunId: null, outcome })
      for (const r of repairs) await insertAiRun(tx, { ...base, ...run(r), kind: 'repair', billedTo: 'platform', repairAttempts: 0, parentRunId: id, outcome: r.result === null ? 'failed' : r.result.ok ? outcome : 'refused' })
      return id
    })
  }

  private async themeNow(): Promise<Map<string, string>> {
    const theme = await this.recovering((client) => client.theme())
    return new Map(theme.files.map((f) => [f.path, f.content]))
  }

  private async guardContext(): Promise<GuardContext> {
    const { row, usedPaths } = await this.system(async (tx) => ({ row: await selectGuardContext(tx, this.deps.storeId), usedPaths: await storeContentPaths(tx, this.deps.storeId) }))
    if (!row) throw new StudioUnavailable('The store is gone.')
    return guardContextFor(row, usedPaths)
  }
}

