import { DurableObject } from 'cloudflare:workers'
import type postgres from 'postgres'
import { parseConfig } from '#core/config'
import { failureCode, logEvent } from '#core/log'
import { withSystemScope } from '#db/scoped/index'
import { selectSandboxImage } from '#db/scoped/coreReleases'
import { containerHost, localSandboxHost, sandboxImageFor, type ClientBundle, type SandboxHost } from '#integrations/sandbox/index'
import { deleteDraft, selectStudioPortalHost } from '#db/scoped/studio'
import { goBack, type GoBackActor, type GoBackResult } from '#saas/storefronts/index'
import { alarmStep, capacityLedger, keptChanges, nextLookMs, studioActivityEveryMs, studioClosedMs, studioTickMs, type AlarmState, closeEndedSockets, defaultStudioCapacity, frameClosed, hashStudioSession, isLiveSocket, liveHub, liveStudioSession, liveStudioSessionHash, liveTag, liveTags, liveUpgradeOf, sweepsAgain, serveFrame, StudioQueued, StudioRunner, StudioUnavailable, studioStoreHeader, type DesignModel, type Grant, type KeptSummary, type LiveEvent, type Prepared, type PublishReady, type StudioAnswer, type StudioApi, type StudioState, preparedAnswer, studioAnswer, type UpgradeAnswer, type UpgradeAsk } from '#saas/studio/index'

// The Durable Objects behind the studio (storefront AI-STUDIO.md §2): StudioSession, one per store, named by the store id
// the session's TenantContext gave (saas/studio studioOf), and StudioCapacity, one for the account.

export interface StudioEnv extends Record<string, unknown> {
  STOREFRONT_SITES?: R2Bucket | undefined
  STOREFRONT_DRAFTS?: R2Bucket | undefined
  STUDIO_CAPACITY?: CapacityNamespace | undefined
}

/** How long a status poll waits for the open it started: a queue answer comes back at once, a container start doesn't. */
const statusWaitMs = 1_000

type Connect = (hyperdrive: { connectionString: string }) => postgres.Sql

/** The RPC the API makes of a store's StudioSession for the frame. */
export interface StudioSessionObject extends Rpc.DurableObjectBranded, StudioApi {
  repair: (storeId: string, input: { failing: string[]; key: string }, model: DesignModel) => Promise<string | null>
  check: (storeId: string, session: string) => Promise<boolean>
  prepareUpgrade: (storeId: string, ask: UpgradeAsk) => Promise<UpgradeAnswer>
}

export interface StudioCapacityObject {
  acquire: (storeId: string) => Promise<Grant>
  release: (storeId: string) => Promise<void>
}

export type CapacityNamespace = DurableObjectNamespace<StudioCapacityObject & Rpc.DurableObjectBranded>

export const studioCapacityClass = () =>
  class StudioCapacity extends DurableObject<StudioEnv> implements StudioCapacityObject {
    private ledger() {
      return capacityLedger(this.ctx.storage, parseConfig(this.env).STUDIO_MAX_RUNNING ?? defaultStudioCapacity)
    }

    acquire(storeId: string): Promise<Grant> {
      return this.ledger().acquire(storeId, Date.now())
    }

    release(storeId: string): Promise<void> {
      return this.ledger().release(storeId)
    }
  }

export const studioSessionClass = (connect: Connect) =>
  class StudioSession extends DurableObject<StudioEnv> implements StudioApi {
    private runner: StudioRunner | null = null
    private lastActive = Date.now()
    /** When the store's last live socket closed: the studio closed in every tab (AI-STUDIO §7 "Stopping"). */
    private lastClosed = 0
    private db: (<T>(work: (sql: postgres.Sql) => Promise<T>) => Promise<T>) | null = null
    private opening: Promise<StudioState> | null = null
    private hub = liveHub(this.ctx.storage, () => this.ctx.getWebSockets(liveTag), () => Date.now())

    /** The object is named by its store's id; it refuses any call for another store, whoever made it. */
    private async ownStore(storeId: string): Promise<void> {
      const own = await this.ctx.storage.get<string>('store')
      if (own !== undefined && own !== storeId) throw new Error('studio: a call for another store')
      if (own === undefined) await this.ctx.storage.put('store', storeId)
    }

    private async runnerFor(storeId: string): Promise<StudioRunner> {
      await this.ownStore(storeId)
      if (this.runner) return this.runner
      const config = parseConfig(this.env)
      const { STOREFRONT_SITES: sites, STOREFRONT_DRAFTS: drafts, STUDIO_CAPACITY: capacity } = this.env
      const hyperdrive = config.HYPERDRIVE
      if (!hyperdrive || !sites || !drafts || !capacity) throw new StudioUnavailable('studio: unconfigured')
      const ledger = capacity.get(capacity.idFromName('account'))
      const db = async <T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> => {
        const sql = connect(hyperdrive)
        try {
          return await work(sql)
        } finally {
          this.ctx.waitUntil(sql.end({ timeout: 5 }))
        }
      }
      this.db = db
      this.runner = new StudioRunner({
        db,
        storeId,
        host: (core) => this.hostFor(core, db, config.SANDBOX_LOCAL_URL),
        drafts,
        sites,
        capacity: { acquire: () => ledger.acquire(storeId), release: () => ledger.release(storeId) },
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
        onBundle: (bundle) => this.announce(bundle),
        kept: keptChanges({ list: (options) => this.ctx.storage.list(options), put: (entries) => this.ctx.storage.put(entries), delete: (keys) => this.ctx.storage.delete(keys) }),
        background: (work) => this.ctx.waitUntil(work),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })
      return this.runner
    }

    private async hostFor(core: string, db: <T>(work: (sql: postgres.Sql) => Promise<T>) => Promise<T>, localUrl: string | undefined): Promise<SandboxHost> {
      if (localUrl) return localSandboxHost(localUrl)
      const container = this.ctx.container
      const image = await sandboxImageFor(container, core, (version) => db((sql) => withSystemScope(sql, (tx) => selectSandboxImage(tx, version))))
      if (!container || !image) throw new StudioUnavailable(`studio: no sandbox for core ${core}`)
      return containerHost(container, image)
    }

    /** Opening, changing, undoing and `studioActivity` keep the container from its idle stop; a status poll doesn't (AI-STUDIO §7). */
    private async active(storeId: string): Promise<StudioRunner> {
      const runner = await this.runnerFor(storeId)
      this.lastActive = Date.now()
      await this.lookBy(this.lastActive + studioTickMs)
      return runner
    }

    /** The alarm at `at`, unless one is already set sooner. */
    private async lookBy(at: number): Promise<void> {
      const set = await this.ctx.storage.getAlarm()
      if (set === null || set > at) await this.ctx.storage.setAlarm(at)
    }

    /** AI-STUDIO §3: start the store's sandbox from its saved draft, or say its place in the queue. */
    async open(storeId: string): Promise<StudioState> {
      try {
        await (await this.active(storeId)).open()
        return { state: 'ready' }
      } catch (error) {
        if (error instanceof StudioQueued) return { state: 'queued', place: error.place }
        if (error instanceof StudioUnavailable) return { state: 'unavailable' }
        throw error
      }
    }

    /** Where the studio stands: a sandbox not loaded yet starts in the background (AI-STUDIO §3), and is "starting" until it answers. */
    async status(storeId: string): Promise<StudioState> {
      const runner = await this.runnerFor(storeId)
      if (runner.loaded) return runner.pending > 0 ? { state: 'busy' } : { state: 'ready' }
      const opening = this.startOpening(storeId)
      const waited = new Promise<null>((resolve) => setTimeout(() => resolve(null), statusWaitMs))
      return (await Promise.race([opening, waited])) ?? { state: 'starting' }
    }

    private startOpening(storeId: string): Promise<StudioState> {
      if (!this.opening) {
        this.opening = this.open(storeId).finally(() => {
          this.opening = null
        })
        this.ctx.waitUntil(this.opening)
      }
      return this.opening
    }

    /** Focus or typing in the studio (#1241): a stopped container starts, a running one's idle stop moves on; at most every 30 s. */
    async activity(storeId: string): Promise<void> {
      const runner = await this.runnerFor(storeId)
      if (!runner.loaded) {
        void this.startOpening(storeId)
        return
      }
      if (Date.now() - this.lastActive < studioActivityEveryMs) return
      await this.active(storeId)
    }

    /** Every accepted change so far written to R2 and design_draft, for the Store API's reads of the draft. */
    async saved(storeId: string): Promise<boolean> {
      return (await this.runnerFor(storeId)).saved()
    }

    async useTemplate(storeId: string, input: { template: string; keep: boolean; userId: string }): Promise<StudioAnswer> {
      const runner = await this.active(storeId)
      return studioAnswer(() => runner.useTemplate(input.template, input.keep, input.userId))
    }

    /** One change, after the ones before it (AI-STUDIO §4); `model` is the Worker's, called back over RPC. */
    async change(storeId: string, input: { request: string; userId: string; billedTo: 'plan' | 'own_key'; run: string }, model: DesignModel): Promise<StudioAnswer> {
      const runner = await this.active(storeId)
      const { run, ...request } = input
      return studioAnswer(() => runner.change({ ...request, model, progress: (event) => void this.publish(storeId, run, event) }))
    }

    /** The Worker's events of a run: its first step, a chat's words and the outcome (AI-STUDIO §4 "Live progress"). */
    async progress(storeId: string, run: string, event: LiveEvent): Promise<void> {
      await this.runnerFor(storeId)
      await this.publish(storeId, run, event)
    }

    /** A lost event never fails the change it reports on: the studio still gets askDesign's answer. */
    private publish(storeId: string, run: string, event: LiveEvent): Promise<unknown> {
      return this.hub.publish(run, event).catch((error: unknown) => logEvent({ event: 'studio_live_lost', api: 'store', storeId, code: failureCode(error) }))
    }

    /** Stop: reaches the running change without waiting in its turn. */
    async cancel(storeId: string): Promise<boolean> {
      return (await this.runnerFor(storeId)).cancel()
    }

    /** The upgrade bot's commit (storefront ARCHITECTURE §7.1), asked by the core-upgrade Workflow with the store id it read. */
    async prepareUpgrade(storeId: string, ask: UpgradeAsk): Promise<UpgradeAnswer> {
      return (await this.runnerFor(storeId)).prepareUpgrade(ask)
    }

    /** AI-STUDIO §6 steps 1–2: the draft moved onto any newer core first; #318's Publish builds what this answers. */
    async prepareToPublish(storeId: string): Promise<PublishReady> {
      return (await this.active(storeId)).prepareToPublish()
    }

    async undo(storeId: string, input: { commit: string; userId: string }): Promise<StudioAnswer> {
      const runner = await this.active(storeId)
      return studioAnswer(() => runner.undo(input.commit, input.userId))
    }

    async texts(storeId: string, input: { page: string; locale: string }): Promise<{ key: string; text: string }[] | null> {
      const runner = await this.active(storeId)
      return runner.texts(input.page, input.locale).catch((error: unknown) => {
        if (error instanceof StudioQueued || error instanceof StudioUnavailable) return null
        throw error
      })
    }

    async editText(storeId: string, input: { locale: string; key: string; text: string; userId: string }): Promise<StudioAnswer | { outcome: 'missing' }> {
      const runner = await this.active(storeId)
      return studioAnswer(() => runner.editText(input.locale, input.key, input.text, input.userId))
    }

    async discard(storeId: string): Promise<void> {
      const runner = await this.runnerFor(storeId)
      const db = this.db
      if (!db) throw new StudioUnavailable('studio: unconfigured')
      await runner.reset(() => db((sql) => withSystemScope(sql, (tx) => deleteDraft(tx, storeId))).then(() => true))
    }

    async prepare(storeId: string, input: { commit: string | null }): Promise<Prepared> {
      const runner = await this.active(storeId)
      return preparedAnswer(() => runner.prepare(input.commit))
    }

    async goBack(storeId: string, input: { versionId: string; by: string; actor: GoBackActor }): Promise<GoBackResult> {
      const runner = await this.runnerFor(storeId)
      const db = this.db
      if (!db) throw new StudioUnavailable('studio: unconfigured')
      let result: GoBackResult = { ok: false, reason: 'NOT_FOUND' }
      await runner.reset(async () => {
        result = await db((sql) => goBack(sql, { storeId, versionId: input.versionId, by: input.by, actor: input.actor, now: new Date() }))
        return result.ok
      })
      return result
    }

    /**
     * A publish's repair (ARCHITECTURE §4.2 step 4), asked by its Workflow with `key` = `{run}:{n}`: a retried step gets the
     * commit already made, never a second change.
     */
    async repair(storeId: string, input: { failing: string[]; key: string }, model: DesignModel): Promise<string | null> {
      const done = await this.ctx.storage.get<string | null>(`repair:${input.key}`)
      if (done !== undefined) return done
      // A busy or unavailable studio throws uncached, so the Workflow step's own retries can still repair.
      const commit = await (await this.active(storeId)).repairPublish(input.failing, model)
      await this.ctx.storage.put(`repair:${input.key}`, commit)
      return commit
    }

    /** The AI's store summary, kept here beside the studio rather than read from the database at every change (#1242). */
    async summary(storeId: string): Promise<KeptSummary | null> {
      await this.ownStore(storeId)
      return (await this.ctx.storage.get<KeptSummary>('summary')) ?? null
    }

    async keepSummary(storeId: string, kept: KeptSummary): Promise<void> {
      await this.ownStore(storeId)
      await this.ctx.storage.put('summary', kept)
    }

    /** "Finishing your previous change…" (AI-STUDIO §4 step 1). */
    async pending(storeId: string): Promise<number> {
      return (await this.runnerFor(storeId)).pending
    }

    /** Asked by the API before a frame's `/shop-api` call (AI-STUDIO §8 "Checked on every request"). */
    async check(storeId: string, session: string): Promise<boolean> {
      const runner = await this.runnerFor(storeId).catch(() => null)
      const db = this.db
      if (!runner || !db) return false
      return (await db((sql) => liveStudioSession(sql, storeId, session, new Date()))) !== null
    }

    /** The studio frame's files and its hot-reload WebSocket (AI-STUDIO §3 step 6), each after the session check. */
    override async fetch(request: Request): Promise<Response> {
      const live = liveUpgradeOf(request)
      if (live) return this.live(live)
      // The API names the host's store; runnerFor refuses it unless it is this object's own.
      const storeId = request.headers.get(studioStoreHeader)
      const runner = storeId ? await this.runnerFor(storeId).catch(() => null) : null
      const db = this.db
      if (!storeId || !runner || !db) return frameClosed()
      return serveFrame(request, {
        storeId,
        live: (forStore, session) => db((sql) => liveStudioSession(sql, forStore, session, new Date())),
        loaded: () => runner.loaded,
        // Opening from the frame is activity, so the alarm that stops it when idle is armed (AI-STUDIO §7).
        open: () => this.ctx.waitUntil(this.active(storeId).then((r) => r.open()).catch(() => undefined)),
        origins: async (frameOrigin) => {
          const portal = await db((sql) => withSystemScope(sql, (tx) => selectStudioPortalHost(tx, storeId)))
          return portal ? { media: frameOrigin, portal: `https://${portal}` } : null
        },
        file: (path, origins) => runner.frameFile(path, origins),
        socket: async (session) => {
          const pair = new WebSocketPair()
          this.ctx.acceptWebSocket(pair[1], [await hashStudioSession(session)])
          return new Response(null, { status: 101, webSocket: pair[0] })
        },
      })
    }

    /** The studio's live socket, checked by the Store API; tagged with its studio session so the sweep closes it with the frame's. */
    private async live(input: { storeId: string; sessionHash: string; after: number }): Promise<Response> {
      if (!(await this.runnerFor(input.storeId).catch(() => null))) return frameClosed()
      const pair = new WebSocketPair()
      await this.hub.connect(() => {
        this.ctx.acceptWebSocket(pair[1], liveTags(input.sessionHash))
        return pair[1]
      }, input.after)
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + studioTickMs)
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    /** The last studio of the store closing starts the 2 minutes before its container stops (AI-STUDIO §7 "Stopping"). */
    override async webSocketClose(socket: WebSocket): Promise<void> {
      await this.socketGone(socket)
    }

    override async webSocketError(socket: WebSocket): Promise<void> {
      await this.socketGone(socket)
    }

    private async socketGone(socket: WebSocket): Promise<void> {
      if (!isLiveSocket(this.ctx.getTags(socket))) return
      if (this.ctx.getWebSockets(liveTag).some((s) => s !== socket && s.readyState === WebSocket.OPEN)) return
      this.lastClosed = Date.now()
      await this.lookBy(this.lastClosed + studioClosedMs)
    }

    override async alarm(): Promise<void> {
      try {
        await this.tick()
      } finally {
        if (sweepsAgain(this.ctx.getWebSockets().length, await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + studioTickMs)
      }
    }

    private alarmState(): AlarmState {
      const now = Date.now()
      const runner = this.runner
      return {
        loaded: runner?.loaded ?? false,
        containerRunning: this.ctx.container?.running ?? false,
        pending: runner?.pending ?? 0,
        openStudios: this.ctx.getWebSockets(liveTag).filter((s) => s.readyState === WebSocket.OPEN).length,
        closedForMs: now - Math.max(this.lastClosed, this.lastActive),
        idleForMs: now - this.lastActive,
        runningForMs: now - (runner?.runningSince ?? now),
      }
    }

    private async tick(): Promise<void> {
      await this.closeEndedSockets()
      const runner = this.runner
      const storeId = await this.ctx.storage.get<string>('store')
      const capacity = this.env.STUDIO_CAPACITY
      const ledger = capacity ? capacity.get(capacity.idFromName('account')) : null
      const state = this.alarmState()
      const step = alarmStep(state)
      if (step === 'rest') return
      if (step === 'stop-orphan') {
        await this.ctx.container?.destroy()
        if (storeId && ledger) await ledger.release(storeId)
        return
      }
      if (!runner) return
      if (step !== 'renew') {
        // Seen in the logs beside Cloudflare's container list when checking the stops on dev (#1241).
        logEvent({ event: 'studio_stopped', api: 'store', storeId: storeId ?? null, code: step })
        await runner.stop()
        return
      }
      const lease = storeId && ledger ? await ledger.acquire(storeId) : null
      // A lease that lapsed while the account filled up isn't renewed: the container stops rather than run over the limit.
      if (lease && !lease.granted) {
        await runner.stop()
        return
      }
      await this.ctx.storage.setAlarm(Date.now() + nextLookMs(state))
    }

    /** A removed user's or signed-out frame stops within a minute of its session ending (AI-STUDIO §8 "Short-lived"). */
    private async closeEndedSockets(): Promise<void> {
      const sockets = this.ctx.getWebSockets()
      if (sockets.length === 0) return
      const storeId = await this.ctx.storage.get<string>('store')
      // After an eviction the sockets outlive the runner: rebuild it to ask, rather than close every frame unasked.
      if (storeId) await this.runnerFor(storeId).catch(() => null)
      const db = this.db
      await closeEndedSockets(
        sockets.map((socket) => ({ tag: this.ctx.getTags(socket)[0], close: () => socket.close(1008, 'closed') })),
        async (hash) => (storeId && db ? (await db((sql) => liveStudioSessionHash(sql, storeId, hash, new Date()))) !== null : false),
      )
    }

    /** The frame's hot reload (AI-STUDIO §4 step 5) to every open frame of this store. */
    private announce(bundle: ClientBundle): void {
      const notice = JSON.stringify({ type: 'bundle', id: bundle.id, entry: bundle.entry })
      for (const socket of this.ctx.getWebSockets()) if (!isLiveSocket(this.ctx.getTags(socket))) socket.send(notice)
    }
  }
