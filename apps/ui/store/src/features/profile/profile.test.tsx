import { ApiError } from '@dripfunnel/shared/graphql'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Profile } from '../../api/profile'
import { messages } from '../../messages'
import { storeStates } from '../staff-session/StaffSessionRoot'
import { Details, saveDetails } from './Details'
import { MyActivity, olderFailed, olderLoaded, startOlder, type ActivityView } from './MyActivity'
import { passwordHint, passwordProblem, submitPassword } from './PasswordCard'
import { profileSample, profileStates } from './profileStates'
import { activityLine, lastFour, profileRefusal } from './profileWords'
import { Sessions } from './Sessions'
import { groupedKey, TwoStep } from './TwoStep'

const words = messages.profile

const profile = (twoFactor: Profile['twoFactor'], extra: Partial<Profile> = {}): Profile => ({
  name: 'Farhan Ali',
  email: 'farhan@example.com',
  pendingEmail: null,
  phone: '+919845011234',
  theme: null,
  passwordChangedAt: null,
  twoFactor,
  ...extra,
})

const none = () => undefined

describe('profile words', () => {
  it('words each refusal the profile API answers, and anything else with the fallback', () => {
    expect(profileRefusal(new ApiError('INVALID_CREDENTIALS', ''), 'x')).toBe(words.twoStep.wrongPassword)
    expect(profileRefusal(new ApiError('PHONE_IN_USE_FOR_SIGN_IN', ''), 'x')).toBe(words.details.phoneLocked)
    expect(profileRefusal(new ApiError('SECOND_FACTOR_REQUIRED', ''), 'x')).toBe(words.twoStep.ownerKeeps)
    expect(profileRefusal(new ApiError('SOMETHING_NEW', ''), 'x')).toBe('x')
    expect(profileRefusal(new TypeError('offline'), 'x')).toBe('x')
  })

  it('words an activity entry with its target, and names a code it does not know', () => {
    expect(activityLine({ action: 'member.invited', target: { type: 'person', label: 'Priya Shah' } })).toBe('Invited Priya Shah')
    expect(activityLine({ action: 'member.invited', target: null })).toBe(`Invited ${words.activity.someone}`)
    expect(activityLine({ action: 'person.signed_in', target: null })).toBe(words.activity.actions['person.signed_in'])
    expect(activityLine({ action: 'store.something_new', target: null })).toContain('store.something_new')
  })

  it('keeps the last four digits of a number or a hint', () => {
    expect(lastFour('+91 98450 11234')).toBe('1234')
    expect(lastFour('•••• 2113')).toBe('2113')
    expect(lastFour(null)).toBe('')
  })

  it('counts down to ten characters, then says strong enough', () => {
    expect(passwordHint('')).toEqual({ text: words.password.hint, tone: 'muted' })
    expect(passwordHint('abcdefghi').text).toBe('1 more character')
    expect(passwordHint('abc').text).toBe('7 more characters')
    expect(passwordHint('abcdefghij')).toEqual({ text: words.password.strong, tone: 'good' })
  })

  it('groups a setup key in fours', () => {
    expect(groupedKey('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
  })
})

describe('the harness states', () => {
  it('never share a name with the staff session’s', () => {
    expect(profileStates.filter((state) => (storeStates as readonly string[]).includes(state))).toEqual([])
  })

  it('has no sample for loading and error, and one for every other state', () => {
    expect(profileSample('loading')).toBeNull()
    expect(profileSample('error')).toBeNull()
    for (const state of profileStates.filter((s) => s !== 'loading' && s !== 'error')) expect(profileSample(state)).not.toBeNull()
  })
})

describe('two-step sign-in', () => {
  it('lets an Owner switch method but never turn it off', () => {
    const html = renderToString(<TwoStep profile={profile({ method: 'app', backupCodesLeft: 8, required: true })} onChanged={none} onToast={none} />)
    expect(html).toContain(words.twoStep.whyOwner)
    expect(html).toContain(words.twoStep.useSms)
    expect(html).not.toContain('df-profile-link')
  })

  it('offers anyone else the way to turn it off', () => {
    const html = renderToString(<TwoStep profile={profile({ method: 'sms', backupCodesLeft: 8, required: false })} onChanged={none} onToast={none} />)
    expect(html).toContain('df-profile-link')
    expect(html).toContain('1234')
  })

  it('warns when three or fewer backup codes are left', () => {
    const html = renderToString(<TwoStep profile={profile({ method: 'app', backupCodesLeft: 2, required: true })} onChanged={none} onToast={none} />)
    expect(html).toContain(words.twoStep.low)
    expect(html).toContain('df-profile-low')
  })

  it('asks an Owner without it to set it up, and the set-up for the password first', () => {
    const off = profile({ method: null, backupCodesLeft: 0, required: true })
    expect(renderToString(<TwoStep profile={off} onChanged={none} onToast={none} />)).toContain(words.twoStep.needed)
    const picking = renderToString(<TwoStep profile={off} onChanged={none} onToast={none} initialSetup={{ step: 'pick', method: 'app', switching: false }} />)
    expect(picking).toContain(words.twoStep.pick)
    expect(picking).toContain(words.twoStep.password)
  })

  it('shows the setup key grouped, and the codes once', () => {
    const off = profile({ method: null, backupCodesLeft: 0, required: true })
    expect(renderToString(<TwoStep profile={off} onChanged={none} onToast={none} initialSetup={{ step: 'verify', method: 'app', switching: false, secret: 'JBSWY3DPEHPK3PXP', hint: null }} />)).toContain('JBSW Y3DP EHPK 3PXP')
    expect(renderToString(<TwoStep profile={off} onChanged={none} onToast={none} initialSetup={{ step: 'codes', codes: ['abcd-efgh'] }} />)).toContain('ABCD-EFGH')
  })
})

describe('your details', () => {
  it('locks the number while it gets the sign-in codes', () => {
    const html = renderToString(<Details profile={profile({ method: 'sms', backupCodesLeft: 8, required: false })} onSaved={none} onChanged={none} onToast={none} />)
    expect(html).toContain(words.details.phoneLocked)
    expect(html).toMatch(/readOnly=""|readonly=""/)
  })

  it('says a new email is waiting for its link', () => {
    const html = renderToString(<Details profile={profile({ method: null, backupCodesLeft: 0, required: false }, { pendingEmail: 'new@example.com' })} onSaved={none} onChanged={none} onToast={none} />)
    expect(html).toContain('new@example.com')
  })
})

describe('saving your details', () => {
  const base = profile({ method: null, backupCodesLeft: 0, required: false })
  const fake = (emailFails = false) => {
    const calls: string[] = []
    return {
      calls,
      api: {
        updateProfile: async (d: { name: string; phone: string | null; theme: Profile['theme'] }) => (calls.push(`details:${d.name}`), { ...base, name: d.name }),
        changeEmail: async (to: string) => {
          calls.push(`email:${to}`)
          if (emailFails) throw new ApiError('INVALID_CREDENTIALS', 'no')
        },
      },
    }
  }

  it('saves the details, then asks for the email link, in that order', async () => {
    const { calls, api } = fake()
    const result = await saveDetails({ details: { name: 'Farhan A', phone: null }, email: { to: 'new@example.com', password: 'pw' } }, null, api)
    expect(calls).toEqual(['details:Farhan A', 'email:new@example.com'])
    expect(result).toMatchObject({ saved: { name: 'Farhan A' }, emailSentTo: 'new@example.com', failure: null })
  })

  it('keeps the details saved when the email is refused, and says why', async () => {
    const { api } = fake(true)
    const result = await saveDetails({ details: { name: 'Farhan B', phone: null }, email: { to: 'new@example.com', password: 'wrong' } }, null, api)
    expect(result.saved).toMatchObject({ name: 'Farhan B' })
    expect(result.emailSentTo).toBeNull()
    expect(profileRefusal(result.failure, 'x')).toBe(words.twoStep.wrongPassword)
  })

  it('sends only what changed', async () => {
    const { calls, api } = fake()
    await saveDetails({ details: null, email: { to: 'only@example.com', password: 'pw' } }, null, api)
    await saveDetails({ details: { name: 'Only name', phone: null }, email: null }, null, api)
    expect(calls).toEqual(['email:only@example.com', 'details:Only name'])
  })
})

describe('your activity, a page at a time', () => {
  const entry = (id: string) => ({ id, occurredAt: '2026-10-05T00:00:00.000Z', action: 'person.signed_in', result: 'success' as const, storeId: null, target: null })
  const ready = (extra: Partial<Extract<ActivityView, { kind: 'ready' }>> = {}): Extract<ActivityView, { kind: 'ready' }> => ({ kind: 'ready', entries: [entry('a'), entry('b')], next: 'c1', more: 'idle', ...extra })

  it('asks for the next page once, however often it is clicked, and not past the end', () => {
    const loading = startOlder(ready())
    expect(loading?.more).toBe('loading')
    expect(loading && startOlder(loading)).toBeNull()
    expect(startOlder(ready({ next: null }))).toBeNull()
  })

  it('adds a page after the rows shown, never a row twice', () => {
    const after = olderLoaded(ready({ more: 'loading' }), { entries: [entry('b'), entry('c')], next: null })
    expect(after.entries.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(after).toMatchObject({ next: null, more: 'idle' })
  })

  it('keeps the rows and the cursor when a page fails', () => {
    expect(olderFailed(ready({ more: 'loading' }))).toMatchObject({ entries: [{ id: 'a' }, { id: 'b' }], next: 'c1', more: 'error' })
  })

  it('says when there is nothing yet', () => {
    expect(renderToString(<MyActivity storeNames={new Map()} sample={[]} />)).toContain(words.activity.empty)
    expect(renderToString(<MyActivity storeNames={new Map([['s1', 'Kesari Threads']])} sample={[{ ...entry('a'), storeId: 's1' }]} />)).toContain('Kesari Threads')
  })
})

describe('changing your password', () => {
  it('stops before sending, in the order the person would fix it', () => {
    expect(passwordProblem('', 'short', 'short')).toBe(words.password.currentMissing)
    expect(passwordProblem('old', 'short', 'short')).toBe(words.password.weak)
    expect(passwordProblem('old', 'long enough 1', 'long enough 2')).toBe(words.password.mismatch)
    expect(passwordProblem('old', 'long enough 1', 'long enough 1')).toBeNull()
  })

  it('sends nothing the form refuses, and words what the server refuses', async () => {
    const sent: string[] = []
    const send = async (current: string) => void sent.push(current)
    expect(await submitPassword({ current: 'old', next: 'short', again: 'short' }, send)).toEqual({ ok: false, error: words.password.weak })
    expect(await submitPassword({ current: 'old', next: 'long enough 1', again: 'long enough 2' }, send)).toEqual({ ok: false, error: words.password.mismatch })
    expect(sent).toEqual([])
    const refusing = (code: string) => async () => Promise.reject(new ApiError(code, 'no'))
    expect(await submitPassword({ current: 'wrong', next: 'long enough 1', again: 'long enough 1' }, refusing('INVALID_CREDENTIALS'))).toEqual({ ok: false, error: words.twoStep.wrongPassword })
    expect(await submitPassword({ current: 'old', next: 'long enough 1', again: 'long enough 1' }, refusing('WEAK_PASSWORD'))).toEqual({ ok: false, error: words.password.weak })
    expect(await submitPassword({ current: 'old', next: 'long enough 1', again: 'long enough 1' }, send)).toEqual({ ok: true })
    expect(sent).toEqual(['old'])
  })
})

describe('where you’re signed in', () => {
  it('puts this browser first and offers to sign out the rest only when there are others', () => {
    const here = { device: 'Chrome on Mac', current: true, createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-05T00:00:00.000Z' }
    const sessions = [{ device: 'Safari on iPhone', current: false, createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: '2026-10-01T00:00:00.000Z' }, here]
    const html = renderToString(<Sessions sessions={sessions} onEnded={none} onToast={none} />)
    expect(html.indexOf(words.sessions.thisBrowser)).toBeLessThan(html.indexOf('Safari on iPhone'))
    expect(html).toContain(words.sessions.signOutOthers)
    expect(renderToString(<Sessions sessions={[here]} onEnded={none} onToast={none} />)).not.toContain(words.sessions.signOutOthers)
  })
})
