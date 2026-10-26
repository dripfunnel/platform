import type { Brand } from '../api/store'
import { loadBrand } from './loadBrand'

const answered: Brand = { name: 'Juniper & Co.', logo: 'https://juniper.my-store.one/shop-api/assets/1', mark: null }
const saved: Brand = { ...answered, name: 'Juniper & Co. (saved)' }

const steps = (overrides: Partial<Parameters<typeof loadBrand>[0]> = {}) => ({
  fetch: jest.fn(() => Promise.resolve<Brand | null>(answered)),
  readSaved: jest.fn(() => Promise.resolve<Brand | null>(saved)),
  save: jest.fn(() => Promise.resolve()),
  ...overrides,
})

describe("loading the store's brand at start", () => {
  it("uses the store's answer and saves it for the next start with no network", async () => {
    const s = steps()
    await expect(loadBrand(s)).resolves.toEqual({ brand: answered, source: 'network' })
    expect(s.save).toHaveBeenCalledWith(answered)
    expect(s.readSaved).not.toHaveBeenCalled()
  })

  it('falls back to the last saved look when the network fails', async () => {
    const s = steps({ fetch: jest.fn(() => Promise.reject(new Error('offline'))) })
    await expect(loadBrand(s)).resolves.toEqual({ brand: saved, source: 'saved' })
    expect(s.save).not.toHaveBeenCalled()
  })

  it("falls back to DripFunnel's defaults the first time, with nothing saved", async () => {
    const s = steps({ fetch: jest.fn(() => Promise.reject(new Error('offline'))), readSaved: jest.fn(() => Promise.resolve<Brand | null>(null)) })
    await expect(loadBrand(s)).resolves.toEqual({ brand: null, source: 'defaults' })
  })

  it('treats a store with no brand yet as an answer, and does not fall back to an old one', async () => {
    const s = steps({ fetch: jest.fn(() => Promise.resolve<Brand | null>(null)) })
    await expect(loadBrand(s)).resolves.toEqual({ brand: null, source: 'defaults' })
    expect(s.readSaved).not.toHaveBeenCalled()
  })
})
