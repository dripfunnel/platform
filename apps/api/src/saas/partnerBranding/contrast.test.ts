import { describe, expect, it } from 'vitest'
import { contrastReport, ratio } from './contrast'

describe('contrast', () => {
  it('matches WCAG 2.2 for the reference pairs', () => {
    expect(ratio('#FFFFFF', '#000000').toFixed(1)).toBe('21.0')
    expect(ratio('#777777', '#FFFFFF').toFixed(2)).toBe('4.48')
  })

  it('passes the prototype’s Northstar pair and fails a pale primary and a dark accent with the fix', () => {
    expect(contrastReport('#0F5E63', '#E8C9A0')).toMatchObject({ passes: true, fix: null, pairs: [{ ratio: '7.5:1', passes: true }, { passes: true }] })
    expect(contrastReport('#9ACDD6', '#E8C9A0').fix).toMatch(/^White button text on #9ACDD6 is \d\.\d:1\. It needs 4\.5:1 to be readable; try a darker primary\.$/)
    expect(contrastReport('#0F5E63', '#555555').fix).toContain('try a lighter accent')
  })

  it('never shows a failing pair at the minimum', () => {
    const report = contrastReport('#777777', '#E8C9A0')
    expect(report.pairs[0]).toEqual({ key: 'primaryOnWhite', ratio: '4.4:1', passes: false })
    expect(report.fix).toBe('White button text on #777777 is 4.4:1. It needs 4.5:1 to be readable; try a darker primary.')
  })
})
