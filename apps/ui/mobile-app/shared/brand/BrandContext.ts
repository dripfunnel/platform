import { createContext, useContext } from 'react'
import type { Brand } from './store'
import type { BrandSource } from './loadBrand'

export type BrandState = { brand: Brand | null; source: BrandSource }

// Apart from the provider so a screen that only reads the store's name does not load the device storage the provider reads the saved look from.
export const BrandContext = createContext<BrandState>({ brand: null, source: 'defaults' })

export const useBrand = (): BrandState => useContext(BrandContext)
