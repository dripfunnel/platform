import type { GoBackActor, GoBackResult } from '../storefronts/index'
import type { DesignModel } from './model'
import { StudioCancelled, StudioQueued, StudioUnavailable, type ChangeOutcome } from './runner'

// What the Store API asks of a store's StudioSession (storefront AI-STUDIO §2–§5), always named by the TenantContext's
// store (`studioOf`). The Durable Object implements it over RPC; tests drive a StudioRunner through the same shape.

/** FIRST-RELEASE §14's studio states: "Opening your studio…", "You're next", ready, and "Finishing your previous change…". */
export type StudioState = { state: 'starting' } | { state: 'queued'; place: number } | { state: 'ready' } | { state: 'busy' } | { state: 'unavailable' }

/** A change's outcome, or why the sandbox couldn't take it; RPC keeps no error class, so both travel as values. */
export type StudioAnswer = ChangeOutcome | { outcome: 'queued'; place: number } | { outcome: 'unavailable' } | { outcome: 'cancelled' }

export const studioAnswer = async <T extends ChangeOutcome | { outcome: 'missing' }>(work: () => Promise<T>): Promise<T | StudioAnswer> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof StudioQueued) return { outcome: 'queued', place: error.place }
    if (error instanceof StudioUnavailable) return { outcome: 'unavailable' }
    if (error instanceof StudioCancelled) return { outcome: 'cancelled' }
    throw error
  }
}

export interface StudioApi {
  status: (storeId: string) => Promise<StudioState>
  useTemplate: (storeId: string, input: { template: string; keep: boolean; userId: string }) => Promise<StudioAnswer>
  /** One AI change (AI-STUDIO §4); `model` is the Worker's, called back over RPC, so no key reaches the object. */
  change: (storeId: string, input: { request: string; userId: string; billedTo: 'plan' | 'own_key' }, model: DesignModel) => Promise<StudioAnswer>
  /** Stops the change running for the store; false when none is (AI-STUDIO §4). */
  cancel: (storeId: string) => Promise<boolean>
  undo: (storeId: string, input: { commit: string; userId: string }) => Promise<StudioAnswer>
  /** The page's words in one language, or null while the sandbox can't load. */
  texts: (storeId: string, input: { page: string; locale: string }) => Promise<{ key: string; text: string }[] | null>
  editText: (storeId: string, input: { locale: string; key: string; text: string; userId: string }) => Promise<StudioAnswer | { outcome: 'missing' }>
  /** Discard: the draft's row and bundle go and the sandbox reloads the live code (AI-STUDIO §5). */
  discard: (storeId: string) => Promise<void>
  /** The hand-off to a publish (AI-STUDIO §6 steps 1–3): the draft's head, or one of its changes, kept for the push. */
  prepare: (storeId: string, input: { commit: string | null }) => Promise<Prepared>
  /** Go back (AI-STUDIO §5): the pointer moves in the studio's turn, and the draft is reset to the version only when it did. */
  goBack: (storeId: string, input: { versionId: string; by: string; actor: GoBackActor }) => Promise<GoBackResult>
}

export type Prepared = { outcome: 'ready'; commit: string; template: string; coreVersion: string } | { outcome: 'nothing' } | { outcome: 'queued'; place: number } | { outcome: 'unavailable' }

/** `prepare`'s answer as a value, as `studioAnswer` does for a change. */
export const preparedAnswer = async (work: () => Promise<Exclude<Prepared, { outcome: 'queued' | 'unavailable' }>>): Promise<Prepared> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof StudioQueued) return { outcome: 'queued', place: error.place }
    if (error instanceof StudioUnavailable) return { outcome: 'unavailable' }
    throw error
  }
}
