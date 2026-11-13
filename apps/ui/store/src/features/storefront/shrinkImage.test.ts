// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { maxImageBytes, shrinkImage } from './shrinkImage'

const drawn: { width: number; height: number; qualities: number[] } = { width: 0, height: 0, qualities: [] }

const stubCanvas = (sizes: number[]) => {
  drawn.qualities = []
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 5880, height: 3824, close: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, done: BlobCallback, _type?: string, quality?: number) {
    drawn.width = this.width
    drawn.height = this.height
    drawn.qualities.push(quality ?? 1)
    done(new Blob([new Uint8Array(sizes[drawn.qualities.length - 1] ?? 0)], { type: 'image/jpeg' }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shrinkImage: an attached image the AI can take', () => {
  it('keeps an image already small enough as it was picked', async () => {
    const small = new Blob([new Uint8Array(1000)], { type: 'image/png' })
    expect(await shrinkImage(small)).toBe(small)
  })

  it('draws a large screenshot at 2,560 px on its long edge as a JPEG, lowering the quality until it fits', async () => {
    stubCanvas([maxImageBytes + 1, 2_000_000])
    const big = new Blob([new Uint8Array(maxImageBytes + 1)], { type: 'image/png' })
    const shrunk = await shrinkImage(big)
    expect(shrunk.type).toBe('image/jpeg')
    expect(shrunk.size).toBe(2_000_000)
    expect([drawn.width, drawn.height]).toEqual([2560, 1665])
    expect(drawn.qualities).toEqual([0.85, 0.7])
  })

  it('sends the picked file when the browser can’t draw it, for the API to judge', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('not an image')))
    const big = new Blob([new Uint8Array(maxImageBytes + 1)], { type: 'image/png' })
    expect(await shrinkImage(big)).toBe(big)
  })
})
