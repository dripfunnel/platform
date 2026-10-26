import AsyncStorage from '@react-native-async-storage/async-storage'
import { brandSchema, type Brand } from '../api/store'

// The last look the store answered with, kept for the next start with no network. The key names the host, so a build
// never reads a look another store's build saved.
const keyOf = (host: string) => `df.brand.${host}`

export const readSavedBrand = async (host: string): Promise<Brand | null> => {
  try {
    const saved = await AsyncStorage.getItem(keyOf(host))
    const parsed = brandSchema.safeParse(saved === null ? null : JSON.parse(saved))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const saveBrand = async (host: string, brand: Brand): Promise<void> => {
  try {
    await AsyncStorage.setItem(keyOf(host), JSON.stringify(brand))
  } catch {
    // Not saving only costs the next offline start its look; it never stops this start.
  }
}
