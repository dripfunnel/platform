import { z } from 'zod'

/** A map pin (#814, #815): both coordinates in range, or neither, which reads as no pin. */
export const pinSchema = z.union([
  z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }),
  z.object({ latitude: z.null().optional(), longitude: z.null().optional() }).transform(() => ({ latitude: null, longitude: null })),
])

export type Pin = { latitude: number; longitude: number }
