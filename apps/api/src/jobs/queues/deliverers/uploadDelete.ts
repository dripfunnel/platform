import { z } from 'zod'
import { GiveUp, type Deliverer } from '../outbox-relay'

export { uploadDeleteKind } from '#engine/modules/cart/index'

// Only a shopper's file's own key (DATA-MODEL §7.6): `stores/{store}/shopper-uploads/{cart}/{file}`.
const payload = z.object({ key: z.string().regex(/^stores\/[0-9a-f-]{36}\/shopper-uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/) })

/**
 * `upload.delete`: the R2 object of a file the shopper removed, after the row's delete commits. Retried with the relay's
 * backoff until R2 answers, so a failed or interrupted delete never leaves the file behind; deleting a missing key succeeds.
 */
export const uploadDeleteDeliverer = (files: { delete: (key: string) => Promise<unknown> }): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    await files.delete(parsed.data.key)
  },
})
