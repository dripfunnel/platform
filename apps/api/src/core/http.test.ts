import { describe, expect, it } from 'vitest'
import { readCapped } from './http'

const streamed = (parts: number[], declared?: number) =>
  new Request('https://x.example/', {
    method: 'POST',
    body: new ReadableStream({
      start(controller) {
        for (const n of parts) controller.enqueue(new Uint8Array(n).fill(7))
        controller.close()
      },
    }),
    headers: declared === undefined ? {} : { 'content-length': String(declared) },
    duplex: 'half',
  } as RequestInit)

describe('readCapped', () => {
  it('reads a declared body into one buffer of its size', async () => {
    const bytes = await readCapped(streamed([3, 4], 7), 10)
    expect(bytes.byteLength).toBe(7)
    expect(bytes.buffer.byteLength).toBe(7)
  })

  it('answers past the cap when a body runs longer than it declared, or than the cap', async () => {
    expect((await readCapped(streamed([5, 5], 6), 10)).byteLength).toBe(11)
    expect((await readCapped(streamed([6, 6]), 10)).byteLength).toBeGreaterThan(10)
  })

  it('keeps what an undeclared or short body sent', async () => {
    expect((await readCapped(streamed([2, 3]), 10)).byteLength).toBe(5)
    expect((await readCapped(streamed([2], 5), 10)).byteLength).toBe(2)
  })
})
