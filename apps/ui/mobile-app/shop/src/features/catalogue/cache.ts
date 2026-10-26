import AsyncStorage from '@react-native-async-storage/async-storage'
import { z } from 'zod'

// The last answer to each catalogue screen, kept so a phone with no signal shows what it last loaded (shop/FIRST-RELEASE.md §1).
// One entry per slot, and it is served only to the same request, so a filter the shopper has not chosen is never shown as chosen.
const keyOf = (host: string, slot: string) => `df.catalogue.${host}.${slot}`
const indexKeyOf = (host: string, group: string) => `df.catalogue.${host}.index.${group}`

/** Slots like `product:<slug>` come one per page opened, so only the most recently saved of each kind are kept. */
export const maxEntriesPerGroup = 20

const entrySchema = z.object({ signature: z.string(), data: z.unknown() })

export const readCached = async (host: string, slot: string, signature: string): Promise<unknown> => {
  try {
    const saved = await AsyncStorage.getItem(keyOf(host, slot))
    const parsed = entrySchema.safeParse(saved === null ? null : JSON.parse(saved))
    return parsed.success && parsed.data.signature === signature ? parsed.data.data : undefined
  } catch {
    return undefined
  }
}

// Remembers the order the slots of one group were saved in, and drops the oldest past the limit.
const trim = async (host: string, slot: string): Promise<void> => {
  const group = slot.slice(0, slot.indexOf(':'))
  const indexKey = indexKeyOf(host, group)
  const saved = await AsyncStorage.getItem(indexKey)
  const parsed = z.array(z.string()).safeParse(saved === null ? [] : JSON.parse(saved))
  const order = [...(parsed.success ? parsed.data : []).filter((known) => known !== slot), slot]
  const evicted = order.splice(0, Math.max(0, order.length - maxEntriesPerGroup))
  await Promise.all(evicted.map((old) => AsyncStorage.removeItem(keyOf(host, old))))
  await AsyncStorage.setItem(indexKey, JSON.stringify(order))
}

export const saveCached = async (host: string, slot: string, signature: string, data: unknown): Promise<void> => {
  try {
    await AsyncStorage.setItem(keyOf(host, slot), JSON.stringify({ signature, data }))
    if (slot.includes(':')) await trim(host, slot)
  } catch {
    // Not keeping an answer only costs the next offline visit; it never fails this one.
  }
}
