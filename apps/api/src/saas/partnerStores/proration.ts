// Moving plans now (FIRST-RELEASE §6.4): the price difference for what is left of the period,
// to the millisecond, in minor units rounded half up. Above zero is charged today, below is a
// credit on the next invoice.
export type Proration = { kind: 'charge'; amount: number } | { kind: 'credit'; amount: number } | { kind: 'none' }

export const prorate = (from: number, to: number, period: { start: Date; end: Date }, now: Date): Proration => {
  const total = BigInt(period.end.getTime() - period.start.getTime())
  const left = BigInt(Math.min(Math.max(period.end.getTime() - now.getTime(), 0), period.end.getTime() - period.start.getTime()))
  const diff = BigInt(to - from)
  if (total <= 0n || left === 0n || diff === 0n) return { kind: 'none' }
  const magnitude = diff < 0n ? -diff : diff
  const amount = Number((magnitude * left * 2n + total) / (total * 2n))
  if (amount === 0) return { kind: 'none' }
  return diff > 0n ? { kind: 'charge', amount } : { kind: 'credit', amount }
}

/** The signed amount the subscription records for billing (#201) to collect. */
export const signed = (p: Proration): number => (p.kind === 'charge' ? p.amount : p.kind === 'credit' ? -p.amount : 0)
