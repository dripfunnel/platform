import { fakeApi } from '../testing/fakeApi'
import { confirmImport, loadCatalogExports, requestCatalogExport, startFileImport, startShopifyImport } from './imports'

const job = (over: Record<string, unknown> = {}) => ({ id: 'e-1', kind: 'products', state: 'done', requestedAt: '2026-10-16T08:00:00Z', rows: 3, truncated: false, csv: 'name\nShirt', expiresAt: null, ...over })

describe('what the app sends the import API', () => {
  it('sends the picked file’s text as it is, with no column changed', async () => {
    const csv = 'Title,Price\nShirt,499\n'
    const { client, calls } = fakeApi({ startCatalogImport: () => ({ startCatalogImport: 'imp-1' }) })

    expect(await startFileImport(client, csv)).toBe('imp-1')
    expect(calls[0]?.variables).toEqual({ file: csv })
  })

  it('confirms with how to treat products already there and where their stock goes', async () => {
    const { client, calls } = fakeApi({ confirmCatalogImport: () => ({ confirmCatalogImport: true }) })

    await confirmImport(client, 'imp-1', 'skip', 'w-2')
    expect(calls[0]?.variables).toEqual({ id: 'imp-1', matching: 'skip', warehouse: 'w-2' })
  })

  it('imports the products a person picked from Shopify by id, or every one', async () => {
    const { client, calls } = fakeApi({ startShopifyImport: () => ({ startShopifyImport: 'imp-2' }) })

    await startShopifyImport(client, ['s-1', 's-2'])
    await startShopifyImport(client, null)
    expect(calls.map((call) => call.variables)).toEqual([{ ids: ['s-1', 's-2'] }, { all: true }])
  })

  it('asks for a products or a stock export, and sends the acting supplier with it', async () => {
    const { client, calls } = fakeApi({ requestCatalogExport: () => ({ requestCatalogExport: 'e-9' }) }, { supplier: 'supplier-1' })

    expect(await requestCatalogExport(client, 'stock')).toBe('e-9')
    expect(calls[0]?.variables).toEqual({ kind: 'stock' })
    expect(calls[0]?.headers['x-supplier']).toBe('supplier-1')
  })
})

describe('the caller’s recent exports', () => {
  it('reads each job’s state, and a finished one carries its CSV', async () => {
    const { client } = fakeApi({
      catalogExports: () => ({
        catalogExports: [job(), job({ id: 'e-2', state: 'queued', csv: null, rows: null }), job({ id: 'e-3', state: 'too_large', csv: null }), job({ id: 'e-4', state: 'expired', csv: null })],
      }),
    })

    const found = await loadCatalogExports(client)
    expect(found.map((one) => one.state)).toEqual(['ready', 'preparing', 'tooLarge', 'expired'])
    expect(found[0]?.csv).toBe('name\nShirt')
  })

  it('reads a finished job with no CSV as failed, since there is nothing to share', async () => {
    const { client } = fakeApi({ catalogExports: () => ({ catalogExports: [job({ csv: null })] }) })

    expect((await loadCatalogExports(client))[0]?.state).toBe('failed')
  })

  it('answers an empty list when the API has none', async () => {
    const { client } = fakeApi({ catalogExports: () => ({ catalogExports: null }) })

    expect(await loadCatalogExports(client)).toEqual([])
  })
})
