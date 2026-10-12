import { DurableObject } from 'cloudflare:workers'
import type postgres from 'postgres'
import { parseConfig } from '#core/config'
import { withSystemScope } from '#db/scoped/index'
import { selectSandboxImage } from '#db/scoped/coreReleases'
import { containerHost, localSandboxHost, type ClientBundle, type SandboxHost } from '#integrations/sandbox/index'
import { selectStudioPortalHost } from '#db/scoped/studio'
import { alarmStep, capacityLedger, closeEndedSockets, defaultStudioCapacity, frameClosed, hashStudioSession, liveStudioSession, liveStudioSessionHash, serveFrame, StudioQueued, StudioRunner, StudioUnavailable, studioStoreHeader, type ChangeOutcome, type DesignModel, type Grant, type UpgradeAnswer, type UpgradeAsk } from '#saas/studio/index'

// The Durable Objects behind the studio (storefront AI-STUDIO.md §2): StudioSession, one per store, named by the store id
// the session's TenantContext gave (saas/studio studioOf), and StudioCapacity, one for the account.

export interface StudioEnv extends Record<string, unknown> {
  STOREFRONT_SITES?: R2Bucket | undefined
  STOREFRONT_DRAFTS?: R2Bucket | undefined
  STUDIO_CAPACITY?: CapacityNamespace | undefined
}

/** The alarm looks every minute while a container may run (AI-STUDIO §7). */
const tickMs = 60 * 1000

export type StudioState = { state: 'ready' } | { state: 'queued'; place: number } | { state: 'unavailable' }

type Connect = (hyperdrive: { connectionString: string }) => postgres.Sql

/** The RPC the API makes of a store's StudioSession for the frame. */
export interface StudioSessionObject extends Rpc.DurableObjectBranded {
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
  class StudioSession extends DurableObject<StudioEnv> {
    private runner: StudioRunner | null = null
    private lastActive = Date.now()
    private db: (<T>(work: (sql: postgres.Sql) => Promise<T>) => Promise<T>) | null = null

    /** The object is named by its store's id; it refuses any call for another store, whoever made it. */
    private async runnerFor(storeId: string): Promise<StudioRunner> {
      const own = await this.ctx.storage.get<string>('store')
      if (own !== undefined && own !== storeId) throw new Error('studio: a call for another store')
      if (own === undefined) await this.ctx.storage.put('store', storeId)
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
      })
      return this.runner
    }

    private async hostFor(core: string, db: <T>(work: (sql: postgres.Sql) => Promise<T>) => Promise<T>, localUrl: string | undefined): Promise<SandboxHost> {
      if (localUrl) return localSandboxHost(localUrl)
      const container = this.ctx.container
      const image = await db((sql) => withSystemScope(sql, (tx) => selectSandboxImage(tx, core)))
      if (!container || !image) throw new StudioUnavailable(`studio: no sandbox for core ${core}`)
      return containerHost(container, image)
    }

    /** Only opening, changing and undoing keep the container from its idle stop; a status poll doesn't (AI-STUDIO §7). */
    private async active(storeId: string): Promise<StudioRunner> {
      const runner = await this.runnerFor(storeId)
      this.lastActive = Date.now()
      await this.ctx.storage.setAlarm(Date.now() + tickMs)
      return runner
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

    /** One change, after the ones before it (AI-STUDIO §4); `model` is the Worker's, called back over RPC. */
    async change(storeId: string, input: { request: string; userId: string; billedTo: 'plan' | 'own_key' }, model: DesignModel): Promise<ChangeOutcome> {
      return (await this.active(storeId)).change({ ...input, model })
    }

    /** The upgrade bot's commit (storefront ARCHITECTURE §7.1), asked by the core-upgrade Workflow with the store id it read. */
    async prepareUpgrade(storeId: string, ask: UpgradeAsk): Promise<UpgradeAnswer> {
      return (await this.runnerFor(storeId)).prepareUpgrade(ask)
    }

    async undo(storeId: string, commit: string, userId: string): Promise<ChangeOutcome> {
      return (await this.active(storeId)).undo(commit, userId)
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

    override async alarm(): Promise<void> {
      await this.closeEndedSockets()
      const runner = this.runner
      const storeId = await this.ctx.storage.get<string>('store')
      const capacity = this.env.STUDIO_CAPACITY
      const ledger = capacity ? capacity.get(capacity.idFromName('account')) : null
      const step = alarmStep({ loaded: runner?.loaded ?? false, containerRunning: this.ctx.container?.running ?? false, pending: runner?.pending ?? 0, idleForMs: Date.now() - this.lastActive })
      if (step === 'rest') {
        // Open frames still need their sockets closed when their sessions end.
        if (this.ctx.getWebSockets().length > 0) await this.ctx.storage.setAlarm(Date.now() + tickMs)
        return
      }
      if (step === 'stop-orphan') {
        await this.ctx.container?.destroy()
        if (storeId && ledger) await ledger.release(storeId)
        return
      }
      if (!runner) return
      if (step === 'idle-stop') {
        await runner.stop()
        return
      }
      const lease = storeId && ledger ? await ledger.acquire(storeId) : null
      // A lease that lapsed while the account filled up isn't renewed: the container stops rather than run over the limit.
      if (lease && !lease.granted) {
        await runner.stop()
        return
      }
      await this.ctx.storage.setAlarm(Date.now() + tickMs)
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
      for (const socket of this.ctx.getWebSockets()) socket.send(notice)
    }
  }
