import type { Brand } from '../api/brand'
import { loadBrand } from './loadBrand'

const answered: Brand = { productName: 'Northstar', primaryColor: '#0A2A4A', accentColor: '#EC844F', font: null, corner: null, helpUrl: null, supportUrl: null, supportEmail: null, files: { logoLight: '/api/brand/logo-light', logoDark: null, mark: null } }
const saved: Brand = { ...answered, productName: 'Northstar (saved)' }

const steps = (overrides: Partial<Parameters<typeof loadBrand>[0]> = {}) => ({
  fetch: jest.fn(() => Promise.resolve<Brand | null>(answered)),
  readSaved: jest.fn(() => Promise.resolve<Brand | null>(saved)),
  save: jest.fn(() => Promise.resolve()),
  ...overrides,
})

describe('loading the partner look at start', () => {
  it("uses the partner's answer and saves it for the next start with no network", async () => {
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

  it('treats a partner with no look yet as an answer, and does not fall back to an old one', async () => {
    const s = steps({ fetch: jest.fn(() => Promise.resolve<Brand | null>(null)) })
    await expect(loadBrand(s)).resolves.toEqual({ brand: null, source: 'defaults' })
    expect(s.readSaved).not.toHaveBeenCalled()
  })
})
