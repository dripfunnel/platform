import { describe, expect, it } from 'vitest'
import type { SetupSessionRow } from '#db/scoped/partners'
import { approvalRuleFor, approvalVerdict } from './approval'

const session = (over: Partial<SetupSessionRow>): SetupSessionRow => ({
  id: 's',
  staff_user_id: 'pm',
  staff_name: 'Priya',
  staff_role: 'staff-partner-manager',
  partner_id: 'p',
  reason: 'r',
  ticket: null,
  started_at: new Date('2026-09-15T00:00:00Z'),
  expires_at: new Date('2026-09-15T02:00:00Z'),
  ended_at: new Date('2026-09-15T01:00:00Z'),
  ended_by_staff_id: null,
  ...over,
})

const submitted = new Date('2026-09-20T00:00:00Z')
const superAdmin = { id: 'sa', role: 'staff-super-admin' as const }
const pm = { id: 'pm', role: 'staff-partner-manager' as const }
const otherPm = { id: 'pm2', role: 'staff-partner-manager' as const }

describe('who may approve (FIRST-RELEASE §4.3)', () => {
  it('a partner that set itself up needs two staff', () => {
    const rule = approvalRuleFor([], submitted)
    expect(rule).toEqual({ setUpBy: null, rule: 'two' })
    expect(approvalVerdict(rule, pm, [])).toBe('needs_second')
    expect(approvalVerdict(rule, otherPm, ['pm'])).toBe('approve')
    expect(approvalVerdict(rule, pm, ['pm'])).toBe('ALREADY_APPROVED_BY_CALLER')
    expect(approvalVerdict(rule, superAdmin, [])).toBe('approve')
  })

  it('a Partner manager who ran the setup needs someone else, and may not be the approver', () => {
    const rule = approvalRuleFor([session({})], submitted)
    expect(rule.rule).toBe('second')
    expect(approvalVerdict(rule, pm, [])).toBe('SET_UP_BY_CALLER')
    expect(approvalVerdict(rule, otherPm, [])).toBe('needs_second')
    expect(approvalVerdict(rule, otherPm, ['pm3'])).toBe('approve')
    expect(approvalVerdict(rule, superAdmin, [])).toBe('approve')
  })

  it('a Super admin who ran the setup approves alone', () => {
    const rule = approvalRuleFor([session({ staff_user_id: 'sa', staff_role: 'staff-super-admin', staff_name: 'Arjun' })], submitted)
    expect(rule.rule).toBe('alone')
    expect(approvalVerdict(rule, superAdmin, [])).toBe('approve')
    expect(approvalVerdict(rule, pm, [])).toBe('needs_second')
  })
})
