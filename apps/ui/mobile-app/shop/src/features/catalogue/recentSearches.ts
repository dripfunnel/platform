import AsyncStorage from '@react-native-async-storage/async-storage'
import { z } from 'zod'

// What the shopper searched for, kept on this phone only: never sent to the API, never shared (shop/FIRST-RELEASE.md §2).
export const maxRecentSearches = 8

const keyOf = (host: string) => `df.recentSearches.${host}`

export const readRecentSearches = async (host: string): Promise<string[]> => {
  try {
    const saved = await AsyncStorage.getItem(keyOf(host))
    const parsed = z.array(z.string()).safeParse(saved === null ? null : JSON.parse(saved))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

const write = async (host: string, searches: string[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(keyOf(host), JSON.stringify(searches))
  } catch {
    // Not remembering a search only costs the shortcut.
  }
}

/** Puts a search first, once: the same words in another case move up instead of repeating. Blank words are not kept. */
export const addRecentSearch = async (host: string, query: string): Promise<string[]> => {
  const words = query.trim()
  if (words === '') return readRecentSearches(host)
  const kept = (await readRecentSearches(host)).filter((search) => search.toLowerCase() !== words.toLowerCase())
  const next = [words, ...kept].slice(0, maxRecentSearches)
  await write(host, next)
  return next
}

export const clearRecentSearches = async (host: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(keyOf(host))
  } catch {
    // Nothing kept that this could leave behind but the shortcut.
  }
}
