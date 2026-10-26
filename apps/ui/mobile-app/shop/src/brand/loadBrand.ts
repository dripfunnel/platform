import type { Brand } from '../api/store'

export type BrandSource = 'network' | 'saved' | 'defaults'

export type LoadedBrand = { brand: Brand | null; source: BrandSource }

type Steps = {
  fetch: () => Promise<Brand | null>
  readSaved: () => Promise<Brand | null>
  save: (brand: Brand) => Promise<void>
}

// The store's answer; else the last look saved on the device; else DripFunnel's defaults (a null brand). A store with no
// brand yet is an answer, not a failure.
export const loadBrand = async ({ fetch, readSaved, save }: Steps): Promise<LoadedBrand> => {
  try {
    const brand = await fetch()
    if (brand) {
      await save(brand)
      return { brand, source: 'network' }
    }
    return { brand: null, source: 'defaults' }
  } catch {
    const saved = await readSaved()
    return saved ? { brand: saved, source: 'saved' } : { brand: null, source: 'defaults' }
  }
}
