import { afterEach, describe, expect, it } from 'vitest'
import { reportProblem, setProblemReporter, type StorefrontProblem } from './report'

afterEach(() => setProblemReporter(null))

describe('reportProblem', () => {
  it('sends each problem once per page, and holds one caught before the page set its reporter', () => {
    reportProblem({ kind: 'checkout', subject: 'checkout' })
    const got: StorefrontProblem[] = []
    setProblemReporter((p) => got.push(p))
    reportProblem({ kind: 'checkout', subject: 'checkout' })
    reportProblem({ kind: 'section', subject: 'hero' })
    expect(got).toEqual([{ kind: 'checkout', subject: 'checkout' }, { kind: 'section', subject: 'hero' }])
  })
})
