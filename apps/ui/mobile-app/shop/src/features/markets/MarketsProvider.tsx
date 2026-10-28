import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createShopClient } from '../../api/client'
import { fetchOffers, type Offers } from '../../api/markets'
import { brandTimeoutMs } from '../../brand/BrandProvider'
import { storeHost } from '../../graphql/storeHost'
import { setLanguage } from '../../messages'
import { useOnline } from '../states/connection'
import { noChoice, phoneLanguages, resolveChoice, type Choice } from './choice'
import { MarketsContext, type Markets } from './MarketsContext'
import { readChoice, readOffers, saveChoice, saveOffers } from './storage'

export { useMarkets } from './MarketsContext'

type Saved = { saved: Choice; offers: Offers | null }

// The shopper's language and currency, read from the phone and settled by what the store offers. A new pick remounts everything below,
// so every screen asks again; the navigation above keeps its place (shop/ARCHITECTURE.md §2).
export function MarketsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Saved | null>(null)
  const host = useMemo(() => storeHost(), [])
  const online = useOnline()
  const ready = state !== null

  useEffect(() => {
    let current = true
    Promise.all([readChoice(host), readOffers(host)])
      .then(([saved, offers]) => current && setState({ saved, offers }))
      .catch(() => current && setState({ saved: noChoice, offers: null }))
    return () => {
      current = false
    }
  }, [host])

  // Asked whenever the phone is online, so a store that changed what it offers, or a phone that started with no signal, catches up.
  useEffect(() => {
    if (!ready || !online) return
    let current = true
    fetchOffers(createShopClient(host, { session: null, cart: null }, brandTimeoutMs))
      .then(async (fresh) => {
        if (!fresh || !current) return
        await saveOffers(host, fresh)
        if (current) setState((now) => (now ? { ...now, offers: fresh } : now))
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [host, ready, online])

  const choice = useMemo(() => (state ? resolveChoice(state.offers, state.saved, phoneLanguages()) : noChoice), [state])
  const choose = useCallback(
    (next: Partial<Choice>) => {
      if (!state) return
      const saved = { ...state.saved, ...next }
      void saveChoice(host, saved)
      setState({ ...state, saved })
    },
    [state, host],
  )
  const key = `${choice.language ?? state?.offers?.languages[0] ?? ''}|${choice.currency ?? state?.offers?.currencies[0] ?? ''}`
  const value = useMemo<Markets>(() => ({ offers: state?.offers ?? null, choice, key, choose }), [state, choice, key, choose])

  if (!state) return null
  // Before the children render, so their words and numbers are in the language chosen.
  setLanguage(choice.language)
  return (
    <MarketsContext.Provider value={value}>
      <Fragment key={key}>{children}</Fragment>
    </MarketsContext.Provider>
  )
}
