import AsyncStorage from '@react-native-async-storage/async-storage'
import { z } from 'zod'
import { offersSchema, type Offers } from '../../api/markets'
import { noChoice, type Choice } from './choice'

const choiceSchema = z.object({ language: z.string().nullable(), currency: z.string().nullable() })

const choiceKey = (host: string) => `df.markets.choice.${host}`
const offersKey = (host: string) => `df.markets.offers.${host}`

const read = async <T>(key: string, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const saved = await AsyncStorage.getItem(key)
    const parsed = schema.safeParse(saved === null ? null : JSON.parse(saved))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const write = (key: string, value: unknown): Promise<void> => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined)

// Public settings, not secrets: kept in plain storage so a phone with no signal still knows the shopper's choice and what the store offered.
export const readChoice = async (host: string): Promise<Choice> => (await read(choiceKey(host), choiceSchema)) ?? noChoice
export const saveChoice = (host: string, choice: Choice): Promise<void> => write(choiceKey(host), choice)
export const readOffers = (host: string): Promise<Offers | null> => read(offersKey(host), offersSchema)
export const saveOffers = (host: string, offers: Offers): Promise<void> => write(offersKey(host), offers)
