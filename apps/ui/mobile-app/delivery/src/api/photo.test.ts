import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { uploadPhoto } from './photo'

const image = { blob: async () => 'IMAGE-BYTES' }
const answering = (body: unknown) => jest.fn(async (url: string) => (url.startsWith('file:') ? image : { json: async () => body }))
const run = (fetchImpl: jest.Mock, token: string | null = 'tok') => uploadPhoto({ host: 'acme.my-store.one', token, uri: 'file:///photo.jpg', mimeType: 'image/jpeg', fetchImpl: fetchImpl as unknown as typeof fetch })

describe('uploading the profile photo', () => {
  it('sends the raw image to the Delivery API with the token and answers the asset’s id', async () => {
    const fetchImpl = answering({ ok: true, asset: { id: 'asset-9' } })
    await expect(run(fetchImpl)).resolves.toBe('asset-9')
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe('https://acme.my-store.one/delivery-api/assets')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('IMAGE-BYTES')
    expect(init.headers).toEqual({ 'content-type': 'image/jpeg', authorization: 'Bearer tok' })
  })

  it('raises the API’s refusal by its code', async () => {
    const error = await run(answering({ ok: false, code: 'TOO_LARGE' })).catch((e: unknown) => e)
    expect(isApiError(error, 'TOO_LARGE')).toBe(true)
  })

  it('raises no answer when the request does not get through', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.startsWith('file:')) return image
      throw new Error('offline')
    })
    const error = await run(fetchImpl).catch((e: unknown) => e)
    expect(isApiError(error, 'NO_RESPONSE')).toBe(true)
  })

  it('raises a bad answer when the body is not what the API sends', async () => {
    const error = await run(answering({ nothing: true })).catch((e: unknown) => e)
    expect(isApiError(error, 'BAD_RESPONSE')).toBe(true)
  })
})
