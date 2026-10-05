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

const read = async (request: Request, limit: number) => {
  const answer = await readCapped(request, limit)
  return answer.ok ? answer.bytes.byteLength : 'too large'
}

describe('readCapped', () => {
  it('reads a body to its size, the buffer exactly that size', async () => {
    const answer = await readCapped(streamed([3, 4], 7), 10)
    expect(answer.ok && [answer.bytes.byteLength, answer.bytes.buffer.byteLength]).toEqual([7, 7])
    expect(await read(streamed([2, 3]), 10)).toBe(5)
    expect(await read(streamed([2], 5), 10)).toBe(2)
  })

  it('refuses a body past the cap or past the length it declared, and a declared length over the cap before reading', async () => {
    expect(await read(streamed([6, 6]), 10)).toBe('too large')
    expect(await read(streamed([5, 5], 6), 10)).toBe('too large')
    expect(await read(streamed([1], 11), 10)).toBe('too large')
  })

  it('holds nothing for a declared length the client never sends', async () => {
    let pulled = 0
    const stalled = new Request('https://x.example/', {
      method: 'POST',
      body: new ReadableStream({
        pull(controller) {
          pulled += 1
          controller.close()
        },
      }),
      headers: { 'content-length': String(30 * 1024 * 1024) },
      duplex: 'half',
    } as RequestInit)
    const answer = await readCapped(stalled, 30 * 1024 * 1024)
    expect(answer.ok && answer.bytes.buffer.byteLength).toBe(0)
    expect(pulled).toBe(1)
  })
})
