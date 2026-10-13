import { z } from 'zod'
import { createApiClient } from './client'
import { typedQuery } from './typed'

const clientAnswering = (data: unknown) => createApiClient({ domain: 'store.example.com', fetchImpl: (() => Promise.resolve({ json: () => Promise.resolve({ data }) })) as unknown as typeof fetch })

describe('typedQuery', () => {
  const schema = z.object({ brand: z.object({ productName: z.string() }).nullable() })

  it('returns an answer that has the shape written from the schema', async () => {
    await expect(typedQuery(clientAnswering({ brand: { productName: 'Northstar' } }))('{ brand }', schema)).resolves.toEqual({ brand: { productName: 'Northstar' } })
  })

  it('answers BAD_RESPONSE, naming the field that drifted', async () => {
    await expect(typedQuery(clientAnswering({ brand: { productName: 7 } }))('{ brand }', schema)).rejects.toMatchObject({ code: 'BAD_RESPONSE', message: expect.stringContaining('brand.productName') })
  })
})
