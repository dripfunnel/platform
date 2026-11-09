// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShopClient } from '../platform/api/client'
import { shopperToken, storedShopState } from '../platform/api/tokens'
import { removeAnswerFile, uploadAnswerFile } from './uploads'

// A shopper's answer files through `{endpoint}/uploads` (#1369): progress, a first file's cart token kept, refusals by code.

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const fakeXhr = (status: number, body: unknown) => {
  const sent: { url: string; headers: Record<string, string> }[] = []
  class Fake {
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    status = status
    responseText = JSON.stringify(body)
    private url = ''
    private headers: Record<string, string> = {}
    open(_: string, url: string) {
      this.url = url
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value
    }
    send() {
      sent.push({ url: this.url, headers: this.headers })
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
      this.onload?.()
    }
  }
  vi.stubGlobal('XMLHttpRequest', Fake)
  return sent
}

describe('answer files', () => {
  it('sends the file beside the API with its headers, reports progress and keeps a new cart’s token', async () => {
    const sent = fakeXhr(200, { id: 'f1', kind: 'image', cartToken: 'new-cart' })
    const progress: number[] = []
    const result = await uploadAnswerFile(createShopClient({ state: storedShopState, storeKey: 'pk' }), 'q 1', new Blob(['x']), (p) => progress.push(p))
    expect(result).toEqual({ ok: true, id: 'f1', kind: 'image' })
    expect(sent[0]?.url).toBe('/shop-api/uploads?question=q%201')
    expect(sent[0]?.headers['x-shop-key']).toBe('pk')
    expect(progress).toEqual([0.5])
    expect(shopperToken('cart')).toBe('new-cart')
  })

  it('answers a refusal’s code, such as a file over 10 MB', async () => {
    fakeXhr(413, { errors: [{ message: 'too big', extensions: { code: 'FILE_TOO_LARGE' } }] })
    expect(await uploadAnswerFile(createShopClient(), 'q1', new Blob(['x']), () => undefined)).toEqual({ ok: false, code: 'FILE_TOO_LARGE' })
  })

  it('removes a file, or says why not', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => (asked.push(`${init.method} ${url}`), url.endsWith('/f2') ? Response.json({ errors: [{ extensions: { code: 'UPLOAD_IN_USE' } }] }, { status: 409 }) : new Response('{}'))))
    expect(await removeAnswerFile(createShopClient(), 'f1')).toBeNull()
    expect(await removeAnswerFile(createShopClient(), 'f2')).toBe('UPLOAD_IN_USE')
    expect(asked).toEqual(['DELETE /shop-api/uploads/f1', 'DELETE /shop-api/uploads/f2'])
  })
})
