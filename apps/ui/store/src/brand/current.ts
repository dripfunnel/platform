import type { Brand } from '../api/brand'

// The look this host was loaded with (main.tsx reads it once, before the first render).
let current: Brand | null = null

export const setBrand = (brand: Brand | null): void => {
  current = brand
}

export const currentBrand = (): Brand | null => current
