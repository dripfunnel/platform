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

/** An answer the rider has not seen yet: the code did not match (`CODE_UNCONFIRMED`), or the step was refused for another reason. */
const noticeSchema = z.object({ deliveryId: z.string(), code: z.string() })
export type PendingNotice = z.infer<typeof noticeSchema>

const savedSchema = z.object({ steps: z.array(entrySchema), notices: z.array(noticeSchema) })
export type Saved = z.infer<typeof savedSchema>

export const nothingSaved: Saved = { steps: [], notices: [] }

const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
const keyOf = (host: string): string => `df.pending.${host}`

/** What is kept for this host; nothing readable is nothing kept. */
export const loadSaved = async (host: string): Promise<Saved> => {
  try {
    const text = await SecureStore.getItemAsync(keyOf(host))
    const parsed = text === null ? null : savedSchema.safeParse(JSON.parse(text))
    return parsed?.success ? parsed.data : nothingSaved
  } catch {
    return nothingSaved
  }
}

export const keepSaved = async (host: string, saved: Saved): Promise<void> => {
  if (saved.steps.length === 0 && saved.notices.length === 0) return SecureStore.deleteItemAsync(keyOf(host))
  await SecureStore.setItemAsync(keyOf(host), JSON.stringify(saved), options)
}
