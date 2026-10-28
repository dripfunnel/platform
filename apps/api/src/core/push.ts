import { z } from 'zod'

export const pushMessages = ['rider.notifications_on', 'rider.offer', 'rider.assigned', 'rider.taken', 'rider.cancelled', 'rider.recalled', 'order.rider_assigned', 'order.picked_up', 'order.delivered', 'order.not_delivered'] as const
export type PushMessageCode = (typeof pushMessages)[number]

/** The outbox payload: no free text, and ids only. */
export const pushPayloadSchema = z
  .object({
    subject: z.object({ kind: z.enum(['rider', 'customer', 'order']), id: z.uuid() }).strict(),
    message: z.enum(pushMessages),
    deliveryId: z.uuid().optional(),
    orderId: z.uuid().optional(),
  })
  .strict()
  .refine((p) => p.deliveryId === undefined || p.orderId === undefined, 'deliveryId or orderId, not both')
export type PushPayload = z.infer<typeof pushPayloadSchema>

