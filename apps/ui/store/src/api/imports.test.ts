import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCatalogExports } from './imports'

// The recent exports come without their files, so a finished one is ready (to be fetched by its id), never failed (#1444).

const serve = (catalogExports: unknown[]) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { catalogExports } })))
const job = (id: string, state: string, csv: string | null = null) => ({ id, state, rows: 42, products: 40, truncated: false, csv, expiresAt: null, kind: 'products', requestedAt: '2026-10-06T10:00:00Z' })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadCatalogExports', () => {
  it('reads a finished export without its file as ready with no link, and a failed one as failed', async () => {
    serve([job('e1', 'done'), job('e2', 'failed'), job('e3', 'expired'), job('e4', 'queued')])
    const read = await loadCatalogExports()
    expect(read.map((e) => [e.id, e.state, e.url])).toEqual([
      ['e1', 'ready', null],
      ['e2', 'failed', null],
      ['e3', 'expired', null],
      ['e4', 'preparing', null],
    ])
    expect(read[0]).toMatchObject({ entries: 42, products: 40 })
  })
})
