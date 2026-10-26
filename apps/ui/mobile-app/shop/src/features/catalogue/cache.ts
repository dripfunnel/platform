import AsyncStorage from '@react-native-async-storage/async-storage'
import { z } from 'zod'

// The last answer to each catalogue screen, kept so a phone with no signal shows what it last loaded (shop/FIRST-RELEASE.md §1).
// One entry per slot, and it is served only to the same request, so a filter the shopper has not chosen is never shown as chosen.
const keyOf = (host: string, slot: string) => `df.catalogue.${host}.${slot}`

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

export const saveCached = async (host: string, slot: string, signature: string, data: unknown): Promise<void> => {
  try {
    await AsyncStorage.setItem(keyOf(host, slot), JSON.stringify({ signature, data }))
  } catch {
    // Not keeping an answer only costs the next offline visit; it never fails this one.
  }
}
