import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// The phone's push registration on the Shop API (api/DELIVERY.md §6): a signed-in customer's phone is theirs for every order and names
// none; a guest's names the order and must hold its token.

export type PushPlatform = 'android' | 'ios'

const done = z.object({ registerPushDevice: z.boolean().nullable().optional() })
const removed = z.object({ unregisterPushDevice: z.boolean().nullable().optional() })

export const registerPushDevice = async (client: ApiClient, token: string, platform: PushPlatform, orderId: string | null): Promise<void> => {
  decode(
    done,
    await client.request<unknown>('mutation($token: String!, $platform: ShopPushPlatform!, $orderId: ID) { registerPushDevice(token: $token, platform: $platform, orderId: $orderId) }', {
      token,
      platform,
      ...(orderId ? { orderId } : {}),
    }),
  )
}

export const unregisterPushDevice = async (client: ApiClient, token: string, orderId: string | null): Promise<void> => {
  decode(
    removed,
    await client.request<unknown>('mutation($token: String!, $orderId: ID) { unregisterPushDevice(token: $token, orderId: $orderId) }', { token, ...(orderId ? { orderId } : {}) }),
  )
}
