import { DurableObject } from 'cloudflare:workers'
import type postgres from 'postgres'
import { parseConfig } from '#core/config'
import { withSystemScope } from '#db/scoped/index'
import { selectSandboxImage } from '#db/scoped/coreReleases'
import { containerHost, localSandboxHost, type ClientBundle, type SandboxHost } from '#integrations/sandbox/index'
import { capacityLedger, defaultStudioCapacity, StudioQueued, StudioRunner, StudioUnavailable, type ChangeOutcome, type DesignModel, type Grant } from '#saas/studio/index'

// The Durable Objects behind the studio (storefront AI-STUDIO.md §2): StudioSession, one per store, named by the store id
// the session's TenantContext gave (saas/studio studioOf), and StudioCapacity, one for the account.

export interface StudioEnv extends Record<string, unknown> {
  STOREFRONT_SITES?: R2Bucket | undefined
  STOREFRONT_DRAFTS?: R2Bucket | undefined
  STUDIO_CAPACITY?: CapacityNamespace | undefined
}

/** AI-STUDIO §9: a container stops after 10 idle minutes; the alarm looks every minute while it runs. */
export const studioIdleMs = 10 * 60 * 1000
const tickMs = 60 * 1000

export type StudioState = { state: 'ready' } | { state: 'queued'; place: number } | { state: 'unavailable' }

type Connect = (hyperdrive: { connectionString: string }) => postgres.Sql

export interface StudioCapacityObject {
  acquire: (storeId: string) => Promise<Grant>
  release: (storeId: string) => Promise<void>
}

export type CapacityNamespace = DurableObjectNamespace<StudioCapacityObject & Rpc.DurableObjectBranded>

export const studioCapacityClass = () =>
  class StudioCapacity extends DurableObject<StudioEnv> implements StudioCapacityObject {
    private ledger() {
      return capacityLedger(this.ctx.storage, parseConfig(this.env).STUDIO_CAPACITY ?? defaultStudioCapacity)
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

    /** The object is named by its store's id; it refuses any call for another store, whoever made it. */
    private async runnerFor(storeId: string): Promise<StudioRunner> {
      const own = await this.ctx.storage.get<string>('store')
      if (own !== undefined && own !== storeId) throw new Error('studio: a call for another store')
      if (own === undefined) await this.ctx.storage.put('store', storeId)
      this.lastActive = Date.now()
      await this.ctx.storage.setAlarm(Date.now() + tickMs)
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

    /** AI-STUDIO §3: start the store's sandbox from its saved draft, or say its place in the queue. */
    async open(storeId: string): Promise<StudioState> {
      try {
        await (await this.runnerFor(storeId)).open()
        return { state: 'ready' }
      } catch (error) {
        if (error instanceof StudioQueued) return { state: 'queued', place: error.place }
        if (error instanceof StudioUnavailable) return { state: 'unavailable' }
        throw error
      }
    }

    /** One change, after the ones before it (AI-STUDIO §4); `model` is the Worker's, called back over RPC. */
    async change(storeId: string, input: { request: string; userId: string; billedTo: 'plan' | 'own_key' }, model: DesignModel): Promise<ChangeOutcome> {
      return (await this.runnerFor(storeId)).change({ ...input, model })
    }

    async undo(storeId: string, commit: string, userId: string): Promise<ChangeOutcome> {
      return (await this.runnerFor(storeId)).undo(commit, userId)
    }

    /** "Finishing your previous change…" (AI-STUDIO §4 step 1). */
    async pending(storeId: string): Promise<number> {
      return (await this.runnerFor(storeId)).pending
    }

    override async alarm(): Promise<void> {
      const runner = this.runner
      if (!runner?.loaded) return
      if (runner.pending === 0 && Date.now() - this.lastActive >= studioIdleMs) {
        await runner.stop()
        return
      }
      const storeId = await this.ctx.storage.get<string>('store')
      const capacity = this.env.STUDIO_CAPACITY
      if (storeId && capacity) await capacity.get(capacity.idFromName('account')).acquire(storeId)
      await this.ctx.storage.setAlarm(Date.now() + tickMs)
    }

    /** The frame's hot reload (AI-STUDIO §4 step 5); its WebSockets come with the frame route. */
    private announce(bundle: ClientBundle): void {
      const notice = JSON.stringify({ type: 'bundle', id: bundle.id, entry: bundle.entry })
      for (const socket of this.ctx.getWebSockets()) socket.send(notice)
    }
  }
