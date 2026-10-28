import { createContext, useContext } from 'react'
import type { Offers } from '../../api/markets'
import { noChoice, type Choice } from './choice'

export type Markets = {
  /** What the store offers; null until the Shop API (or the phone's last copy) has said. */
  offers: Offers | null
  /** What goes out with every request. */
  choice: Choice
  /** The language and currency that apply, as one string: the same whether the shopper picked the store's default or never picked. */
  key: string
  /** Keeps a pick on the phone and starts using it; the screens below start over in the new language and currency. */
  choose: (next: Partial<Choice>) => void
}

// With no provider (a screen under test) nothing was picked and nothing is offered.
const none: Markets = { offers: null, choice: noChoice, key: '|', choose: () => undefined }

export const MarketsContext = createContext<Markets>(none)

export const useMarkets = (): Markets => useContext(MarketsContext)
