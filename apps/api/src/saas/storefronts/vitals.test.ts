import { describe, expect, it } from 'vitest'
import { buckets, bucketOf, type VitalsDays } from '#db/scoped/vitals'
import { compare, minSamples, p75 } from './vitals'

const days = (n: number, m: { lcp: number; inp: number; cls: number }): VitalsDays => {
  const hist = (measure: 'lcp' | 'inp' | 'cls', value: number) => Array.from({ length: buckets[measure].count }, (_, i) => (i === bucketOf(measure, value) ? n : 0))
  return { page_kind: 'home', device: 'phone', samples: n, lcp_hist: hist('lcp', m.lcp), inp_hist: hist('inp', m.inp), cls_hist: hist('cls', m.cls) }
}
const base = { lcp: 1500, inp: 100, cls: 20 }

describe('the regression rule', () => {
  it('reads the 75th percentile as its bucket’s upper bound', () => {
    expect(p75([1, 1, 1, 1], 'lcp')).toBe(750)
    expect(p75([0, 4, 0, 0], 'inp')).toBe(50)
  })

  it('rolls back on LCP or INP doubled or CLS above 0.25, flags a fifth worse, and needs samples on both sides', () => {
    const verdict = (after: typeof base, n = minSamples) => compare([days(n, base)], [days(n, after)])[0]?.verdict
    expect(verdict({ ...base, lcp: 3800 })).toBe('severe')
    expect(verdict({ ...base, inp: 230 })).toBe('severe')
    expect(verdict({ ...base, cls: 300 })).toBe('severe')
    expect(verdict({ ...base, lcp: 2000 })).toBe('regressed')
    expect(verdict(base)).toBe('ok')
    expect(verdict({ ...base, lcp: 9000 }, minSamples - 1)).toBeUndefined()
  })

  it('reads a move within the histogram’s resolution, or a doubling still under Google’s “good”, as no regression', () => {
    const verdict = (from: typeof base, to: typeof base) => compare([days(minSamples, from)], [days(minSamples, to)])[0]?.verdict
    // INP 10 ms → 30 ms reads 25 → 50 at the bucket bounds: doubled, but a single bucket and far under 200 ms.
    expect(verdict({ ...base, inp: 10 }, { ...base, inp: 30 })).toBe('ok')
    expect(verdict({ ...base, lcp: 600 }, { ...base, lcp: 1300 })).toBe('regressed')
    expect(verdict({ ...base, lcp: 600 }, { ...base, lcp: 800 })).toBe('ok')
  })
})
