import { useCallback, useEffect, useState } from 'react'
import { loadCartPlace, loadReminderSending, type ReminderSending } from '../../api/carts'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'

export type CartFacts = {
  /** Whether reminders go by themselves and the plan's level; null while unread, or when it couldn't be read. */
  sending: ReminderSending | null
  country: string | null
  /** The store's pricing currency, for the minimum cart value; null when it couldn't be read. */
  currency: string | null
  reload: () => void
}

// Hints beside the carts: how reminders go and the store's country and currency. A read that fails leaves its hint out, never the screen.
export function useCartFacts(client: ApiClient): CartFacts {
  const [sending, setSending] = useState<ReminderSending | null>(null)
  const [place, setPlace] = useState<{ country: string | null; currency: string | null }>({ country: null, currency: null })
  const [round, setRound] = useState(0)

  useEffect(() => {
    let current = true
    loadReminderSending(client).then(
      (next) => current && setSending(next),
      () => current && setSending(null),
    )
    loadCartPlace(client).then(
      (next) => current && setPlace(next),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [client, round])

  return { sending, country: place.country, currency: place.currency, reload: useCallback(() => setRound((n) => n + 1), []) }
}
