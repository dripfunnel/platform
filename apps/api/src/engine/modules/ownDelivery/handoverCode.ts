import type { SecretBox } from '#auth/secretBox'
import { DispatchRefused } from '#core/dispatch'

export const maxCodeAttempts = 5

// Bound to its delivery, so a sealed code copied onto another row opens to nothing (DELIVERY §3, Handover code).
export const sealHandoverCode = async (box: SecretBox | null, deliveryId: string): Promise<string> => {
  if (!box) throw new DispatchRefused('UNAVAILABLE')
  const [n = 0] = crypto.getRandomValues(new Uint32Array(1))
  return box.seal(`${deliveryId}:${String(n % 10_000).padStart(4, '0')}`)
}

export const handoverCodeMatches = async (box: SecretBox, deliveryId: string, sealed: string, typed: string): Promise<boolean> =>
  (await box.open(sealed)) === `${deliveryId}:${typed}`
