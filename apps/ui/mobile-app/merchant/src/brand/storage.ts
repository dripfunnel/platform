import AsyncStorage from '@react-native-async-storage/async-storage'
import { brandSchema, type Brand } from '../api/brand'

// The last look the partner answered with, kept for the next start with no network. The key names the
// host, so a build never reads a look another partner's build saved.
const keyOf = (domain: string) => `df.brand.${domain}`

export const readSavedBrand = async (domain: string): Promise<Brand | null> => {
  try {
    const saved = await AsyncStorage.getItem(keyOf(domain))
    const parsed = brandSchema.safeParse(saved === null ? null : JSON.parse(saved))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const saveBrand = async (domain: string, brand: Brand): Promise<void> => {
  try {
    await AsyncStorage.setItem(keyOf(domain), JSON.stringify(brand))
  } catch {
    // Not saving only costs the next offline start its look; it never stops this start.
  }
}
