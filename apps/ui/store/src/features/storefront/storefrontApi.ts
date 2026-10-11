import { uploadPhoto } from '../../api/productEditor'
import { loadBrand, loadSeo, saveBrand, saveSeo } from '../../api/storefront'
import { sampleBrand, sampleSeo, type StorefrontState } from './storefrontStates'

/** What Storefront reads and writes: the Store API, or the harness's sample kept in memory (ui/README.md §6). */
export interface StorefrontApi {
  loadBrand: typeof loadBrand
  saveBrand: typeof saveBrand
  loadSeo: typeof loadSeo
  saveSeo: typeof saveSeo
  uploadImage: typeof uploadPhoto
}

export const storeApi: StorefrontApi = { loadBrand, saveBrand, loadSeo, saveSeo, uploadImage: uploadPhoto }

/** The harness's store: writes change the sample in memory, so a click-through behaves without a backend. */
export const sampleApi = (state: StorefrontState): StorefrontApi => {
  let brand = sampleBrand(state)
  let seo = sampleSeo(state)
  let uploads = 0
  return {
    loadBrand: () => Promise.resolve(brand),
    saveBrand: (input) => {
      brand = { ...input, brandReady: true }
      return Promise.resolve(brand)
    },
    loadSeo: () => Promise.resolve(seo),
    saveSeo: (input) => {
      seo = input
      return Promise.resolve(seo)
    },
    uploadImage: () => {
      uploads += 1
      return Promise.resolve({ ok: true, assetId: `sample-upload-${uploads}` })
    },
  }
}
