import { uploadPhoto } from '../../api/productEditor'
import { checkDomain, connectDomain, loadBrand, loadDomains, loadSeo, loadShareImages, makeDomainPrimary, removeDomain, saveBrand, saveSeo } from '../../api/storefront'
import type { StorefrontDomains } from '../../api/storefront'
import { sampleBrand, sampleDomains, sampleSeo, type StorefrontState } from './storefrontStates'

/** What Storefront reads and writes: the Store API, or the harness's sample kept in memory (ui/README.md §6). */
export interface StorefrontApi {
  loadBrand: typeof loadBrand
  saveBrand: typeof saveBrand
  loadSeo: typeof loadSeo
  saveSeo: typeof saveSeo
  loadDomains: typeof loadDomains
  connectDomain: typeof connectDomain
  checkDomain: typeof checkDomain
  makeDomainPrimary: typeof makeDomainPrimary
  removeDomain: typeof removeDomain
  loadShareImages: typeof loadShareImages
  uploadImage: typeof uploadPhoto
}

export const storeApi: StorefrontApi = { loadBrand, saveBrand, loadSeo, saveSeo, loadDomains, connectDomain, checkDomain, makeDomainPrimary, removeDomain, loadShareImages, uploadImage: uploadPhoto }

/** The harness's store: writes change the sample in memory, so a click-through behaves without a backend. */
export const sampleApi = (state: StorefrontState): StorefrontApi => {
  let brand = sampleBrand(state)
  let seo = sampleSeo(state)
  let domains: StorefrontDomains = sampleDomains(state)
  let uploads = 0
  const domain = (id: string) => domains.domains.find((d) => d.id === id)
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
    loadDomains: () => Promise.resolve(domains),
    connectDomain: (host) => {
      const added = { id: `sample-${host}`, host, kind: 'custom' as const, status: 'waiting' as const, primary: false, checkedAt: null, records: [{ type: 'CNAME', name: host, value: 'shops.edge.dripfunnel.com', found: null }, { type: 'TXT', name: `_df-verify.${host}`, value: 'df-verify=sample', found: null }] }
      domains = { ...domains, domains: [...domains.domains, added] }
      return Promise.resolve(added)
    },
    checkDomain: (id) => {
      domains = { ...domains, domains: domains.domains.map((d) => (d.id === id ? { ...d, checkedAt: new Date().toISOString() } : d)) }
      return Promise.resolve()
    },
    makeDomainPrimary: (id) => {
      domains = { ...domains, domains: domains.domains.map((d) => ({ ...d, primary: d.id === id })) }
      return Promise.resolve()
    },
    removeDomain: (id) => {
      const gone = domain(id)
      domains = { ...domains, domains: domains.domains.filter((d) => d.id !== id).map((d) => (gone?.primary && d.kind === 'free' ? { ...d, primary: true } : d)) }
      return Promise.resolve()
    },
    loadShareImages: () => Promise.resolve(state === 'list' ? ['sample-photo-1', 'sample-photo-2', 'sample-photo-3'] : []),
    uploadImage: () => {
      uploads += 1
      return Promise.resolve({ ok: true, assetId: `sample-upload-${uploads}` })
    },
  }
}
