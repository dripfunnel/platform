import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'

// What a phone without signal keeps: the last step of a delivery with its time and key, and the typed code until it is sent
// (docs/mobile-app/delivery/FIRST-RELEASE.md §1). Secure storage only; nothing else is ever queued.
const stepSchema = z.object({ deliveryId: z.string(), at: z.string(), key: z.string() })
const entrySchema = z.discriminatedUnion('kind', [
  stepSchema.extend({ kind: z.literal('delivered'), code: z.string(), cashCollected: z.boolean().nullable() }),
  stepSchema.extend({ kind: z.literal('failed'), reason: z.enum(['no_one_home', 'refused', 'wrong_address']) }),
])
export type PendingStep = z.infer<typeof entrySchema>

/** An answer for the rider: the code did not match (`CODE_UNCONFIRMED`), or the step was refused for another reason. A dismissed `CODE_UNCONFIRMED` stays, hidden from Home's banner, so the store's delivery is never offered again. */
const noticeSchema = z.object({ deliveryId: z.string(), code: z.string(), dismissed: z.boolean().default(false) })
export type PendingNotice = z.infer<typeof noticeSchema>

const savedSchema = z.object({ steps: z.array(entrySchema), notices: z.array(noticeSchema) })
export type Saved = z.infer<typeof savedSchema>

export const nothingSaved: Saved = { steps: [], notices: [] }

const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
// Kept per rider, so a rider who signs in on this phone never sees or sends another's steps.
const keyOf = (host: string, riderId: string): string => `df.pending.${host}.rider.${riderId}`
const lastRiderKey = (host: string): string => `df.pending.${host}.last`

/** What is kept for this rider; nothing readable is nothing kept. */
export const loadSaved = async (host: string, riderId: string): Promise<Saved> => {
  try {
    const text = await SecureStore.getItemAsync(keyOf(host, riderId))
    const parsed = text === null ? null : savedSchema.safeParse(JSON.parse(text))
    return parsed?.success ? parsed.data : nothingSaved
  } catch {
    return nothingSaved
  }
}

/** Refuses when it could not write, so a step is never told to the rider as saved when it is not. */
export const keepSaved = async (host: string, riderId: string, saved: Saved): Promise<void> => {
  if (saved.steps.length === 0 && saved.notices.length === 0) return SecureStore.deleteItemAsync(keyOf(host, riderId))
  await SecureStore.setItemAsync(keyOf(host, riderId), JSON.stringify(saved), options)
}

/** The rider this phone last knew to be signed in, for when the phone has no signal to ask. */
export const loadLastRider = (host: string): Promise<string | null> => SecureStore.getItemAsync(lastRiderKey(host)).catch(() => null)

export const forgetLastRider = (host: string): Promise<void> => SecureStore.deleteItemAsync(lastRiderKey(host)).catch(() => undefined)

export const keepLastRider =(host: string, riderId: string): Promise<void> => SecureStore.setItemAsync(lastRiderKey(host), riderId, options).catch(() => undefined)
