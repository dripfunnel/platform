import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { brandTimeoutMs, storeHost } from '@dripfunnel/mobile-shared/brand'
import { useOnline } from '@dripfunnel/mobile-shared/connection'
import { createShopClient } from '../../api/client'
import { fetchOffers, type Offers } from '../../api/markets'
import { setLanguage } from '../../messages'
import { noChoice, phoneLanguages, resolveChoice, type Choice } from './choice'
import { MarketsContext, type Markets } from './MarketsContext'
import { readChoice, readOffers, saveChoice, saveOffers } from './storage'

export { useMarkets } from './MarketsContext'

type Settled = { saved: Choice; offers: Offers | null; choice: Choice }

// What the app speaks follows the choice, so it is set here, as the choice is settled, and never while rendering.
const settle = (saved: Choice, offers: Offers | null): Settled => {
  const choice = resolveChoice(offers, saved, phoneLanguages())
  setLanguage(choice.language)
  return { saved, offers, choice }
}

// The shopper's language and currency, read from the phone and settled by what the store offers. A new pick remounts everything below,
// so every screen asks again; the navigation above keeps its place (shop/ARCHITECTURE.md §2).
export function MarketsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Settled | null>(null)
  const latest = useRef<Settled | null>(null)
  const host = useMemo(() => storeHost(), [])
  const online = useOnline()
  const ready = state !== null

  const apply = useCallback((next: Settled) => {
    latest.current = next
    setState(next)
  }, [])

  useEffect(() => {
    let current = true
    Promise.all([readChoice(host), readOffers(host)])
      .then(([saved, offers]) => current && apply(settle(saved, offers)))
      .catch(() => current && apply(settle(noChoice, null)))
    return () => {
      current = false
    }
  }, [host, apply])

  // Asked whenever the phone is online, so a store that changed what it offers, or a phone that started with no signal, catches up.
  useEffect(() => {
    if (!ready || !online) return
    let current = true
    fetchOffers(createShopClient(host, { session: null, cart: null }, brandTimeoutMs))
      .then(async (fresh) => {
        if (!fresh || !current) return
        await saveOffers(host, fresh)
        if (current && latest.current) apply(settle(latest.current.saved, fresh))
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [host, ready, online, apply])

  const choose = useCallback(
    (next: Partial<Choice>) => {
      if (!latest.current) return
      const saved = { ...latest.current.saved, ...next }
      void saveChoice(host, saved)
      apply(settle(saved, latest.current.offers))
    },
    [host, apply],
  )

  const key = `${state?.choice.language ?? state?.offers?.languages[0] ?? ''}|${state?.choice.currency ?? state?.offers?.currencies[0] ?? ''}`
  const value = useMemo<Markets>(() => ({ offers: state?.offers ?? null, choice: state?.choice ?? noChoice, key, choose }), [state, key, choose])

  if (!state) return null
  return (
    <MarketsContext.Provider value={value}>
      <Fragment key={key}>{children}</Fragment>
    </MarketsContext.Provider>
  )
}
