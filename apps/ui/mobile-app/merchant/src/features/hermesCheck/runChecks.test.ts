import type { FormatCase } from '../../format/cases'
import { formatCases } from '../../format/cases'
import { reportOf, runChecks } from './runChecks'

const header = { engine: 'Hermes test', platform: 'android', installed: ['listformat'] }

describe('the Hermes check runner', () => {
  it('passes every input on an engine that formats as expected', () => {
    const results = runChecks('en')
    expect(results).toHaveLength(formatCases.length)
    expect(results.every((r) => r.passed)).toBe(true)
  })

  it('reports a different string as a difference, with both strings', () => {
    const cases: FormatCase[] = [{ group: 'money', name: 'JPY', actual: () => '¥123,456.00', expected: '¥123,456' }]
    expect(runChecks('en', cases)).toEqual([{ group: 'money', name: 'JPY', expected: '¥123,456', actual: '¥123,456.00', passed: false }])
  })

  it('reports a feature the engine lacks as a difference, not a crash', () => {
    const cases: FormatCase[] = [
      {
        group: 'list',
        name: 'three items',
        actual: () => {
          throw new TypeError('Intl.ListFormat is not a constructor')
        },
        expected: 'a, b, and c',
      },
    ]
    expect(runChecks('en', cases)[0]).toMatchObject({ passed: false, actual: 'threw TypeError' })
  })

  it('writes one line per input and a total, quoting each string so a stray space shows', () => {
    const report = reportOf(
      [
        { group: 'money', name: 'USD', expected: '$1.00', actual: '$1.00', passed: true },
        { group: 'money', name: 'JPY', expected: '¥100', actual: '¥ 100', passed: false },
      ],
      header,
    )
    expect(report.split('\n')).toEqual([
      'HERMES_CHECK engine=Hermes test platform=android polyfills=listformat',
      'ok   money / USD: expected "$1.00"',
      'DIFF money / JPY: expected "¥100" got "¥ 100"',
      'HERMES_CHECK 1/2 match',
    ])
  })
})
