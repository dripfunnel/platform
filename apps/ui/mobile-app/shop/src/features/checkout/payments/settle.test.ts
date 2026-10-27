import type { PaymentRead } from '../../../api/cart'
import { settle, type Clock } from './settle'

// A clock that moves only when the poll waits, so a thirty-second limit takes no time to test.
const clock = (): Clock & { waited: number[] } => {
  let at = 0
  const waited: number[] = []
  return {
    waited,
    now: () => at,
    wait: async (ms) => {
      waited.push(ms)
      at += ms
    },
  }
}
const reads = (...answers: (PaymentRead | null | Error)[]) => {
  let i = 0
  return jest.fn(async () => {
    const answer = answers[Math.min(i++, answers.length - 1)]
    if (answer instanceof Error) throw answer
    return answer ?? null
  })
}
const waiting: PaymentRead = { cancelled: false, paid: false }

describe('waiting for the provider to confirm a payment', () => {
  it('reads the order again until the webhook has marked it paid, then stops', async () => {
    const read = reads(waiting, waiting, { cancelled: false, paid: true })
    const time = clock()
    expect(await settle(read, time, 2000, 30_000)).toBe('paid')
    expect(read).toHaveBeenCalledTimes(3)
    expect(time.waited).toEqual([2000, 2000])
  })

  it('gives up at its limit as pending, never as paid or failed, after a bounded number of reads', async () => {
    const read = reads(waiting)
    expect(await settle(read, clock(), 2000, 30_000)).toBe('pending')
    expect(read).toHaveBeenCalledTimes(16)
  })

  it('asks again after a read that failed, and does not count it as a failure', async () => {
    const read = reads(new Error('no signal'), null, { cancelled: false, paid: true })
    expect(await settle(read, clock(), 2000, 30_000)).toBe('paid')
  })

  it('stops at once for an order that was cancelled', async () => {
    const read = reads({ cancelled: true, paid: false })
    expect(await settle(read, clock(), 2000, 30_000)).toBe('cancelled')
    expect(read).toHaveBeenCalledTimes(1)
  })
})
