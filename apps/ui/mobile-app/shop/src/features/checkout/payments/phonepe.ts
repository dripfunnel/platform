import { z } from 'zod'
import type { PaymentStart } from '../../../api/cart'
import type { Shown } from './outcome'
import { loadPhonePe } from './sdks'
import type { SheetFacts } from './stripe'

const result = z.object({ status: z.string() })

const environmentOf = (mode: string | null): string | null => (mode === 'test' ? 'SANDBOX' : mode === 'live' ? 'PRODUCTION' : null)

/** PhonePe's checkout, opened from the API's SDK order, token and merchant id (shop/ARCHITECTURE.md §4); the SDK loads only here, so Expo Go still runs the rest. */
export const presentPhonePe = async (start: PaymentStart, facts: SheetFacts): Promise<Shown> => {
  const { providerOrderId, token, publicKey: merchantId } = start
  const environment = environmentOf(start.mode)
  if (!providerOrderId || !token || !merchantId || !environment) return 'unavailable'
  const { default: PhonePe } = loadPhonePe()
  const flowId = (start.providerRef ?? '').replace(/[^A-Za-z0-9]/g, '') || 'order'
  if ((await PhonePe.init(environment, merchantId, flowId, false)) === false) return 'unavailable'
  const request = JSON.stringify({ orderId: providerOrderId, merchantId, token, paymentMode: { type: 'PAY_PAGE' } })
  const parsed = result.safeParse(await PhonePe.startTransaction(request, facts.build.scheme))
  if (!parsed.success) return 'declined'
  return parsed.data.status === 'SUCCESS' ? 'done' : parsed.data.status === 'INTERRUPTED' ? 'cancelled' : 'declined'
}
