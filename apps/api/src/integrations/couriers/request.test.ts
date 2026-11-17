import { describe, expect, it } from 'vitest'
import { courierCall } from './request'

describe('a courier call', () => {
  it('calls fetch as a plain function, which the Workers runtime requires (a method call is "Illegal invocation")', async () => {
    const receivers: unknown[] = []
    const fetchImpl = function (this: unknown) {
      receivers.push(this)
      return Promise.resolve(new Response('{}'))
    } as unknown as typeof fetch
    const response = await courierCall('https://courier.example/x', {}, { fetchImpl, signal: undefined, name: 'courier' })
    expect(response.status).toBe(200)
    expect(receivers).toEqual([undefined])
  })
})
