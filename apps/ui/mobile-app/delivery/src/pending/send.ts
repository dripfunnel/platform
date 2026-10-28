import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { markDelivered, markFailed } from '../api/delivery'
import type { PendingNotice, PendingStep } from './store'

export type Flushed = {
  /** What is still to send: the step with no answer and every step after it, in order. */
  left: PendingStep[]
  /** Answers that were not a plain yes, for the rider to read. */
  notices: PendingNotice[]
  /** Whether any step reached the API and was taken. */
  sent: boolean
}

const retryable: ReadonlySet<string> = new Set(['NO_RESPONSE', 'UNAUTHENTICATED', 'BAD_RESPONSE', 'UNKNOWN'])

const send = (client: ApiClient, step: PendingStep): Promise<void> =>
  step.kind === 'delivered'
    ? markDelivered(client, step.deliveryId, { code: step.code, cashCollected: step.cashCollected, at: step.at, key: step.key })
    : markFailed(client, step.deliveryId, { reason: step.reason, at: step.at, key: step.key })

/** Sends the steps in the order they were taken, each under its own time and key. It stops at the first with no answer so nothing is sent out of order. */
export const flushSteps = async (client: ApiClient, steps: readonly PendingStep[]): Promise<Flushed> => {
  const notices: PendingNotice[] = []
  let sent = false
  for (const [index, step] of steps.entries()) {
    try {
      await send(client, step)
      sent = true
    } catch (error) {
      // Only a refusal the API named is final and told to the rider; no answer, an ended session or an answer that is not the API's is tried again, never dropped.
      if (!isApiError(error) || retryable.has(error.code)) return { left: steps.slice(index), notices, sent }
      notices.push({ deliveryId: step.deliveryId, code: error.code })
    }
  }
  return { left: [], notices, sent }
}
