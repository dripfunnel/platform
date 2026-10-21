import type { MyActivityEntry, Profile, SignedInSession } from '../../api/profile'
import type { Setup } from './TwoStep'

// My profile's states under ?state= (ui/README.md §6), named apart from StaffSessionRoot's.
export const profileStates = ['loading', 'error', 'owner', 'needsSetup', 'staff', 'sms', 'lowCodes', 'pendingEmail', 'setupPick', 'setupApp', 'setupSms', 'setupCodes'] as const

export type ProfileState = (typeof profileStates)[number]

export interface ProfileSample {
  profile: Profile
  sessions: SignedInSession[]
  activity: MyActivityEntry[]
  setup?: Setup
}

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const base =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? {
        profile: {
          name: 'Farhan Ali',
          email: 'farhan@kesarithreads.in',
          pendingEmail: null,
          phone: '+919845011234',
          theme: null,
          passwordChangedAt: '2026-08-14T09:30:00.000Z',
          twoFactor: { method: 'app', backupCodesLeft: 8, required: true },
        } satisfies Profile,
        sessions: [
          { device: 'Chrome on Mac', current: true, createdAt: '2026-10-05T08:00:00.000Z', lastUsedAt: '2026-10-05T10:40:00.000Z' },
          { device: 'Safari on iPhone', current: false, createdAt: '2026-09-30T07:00:00.000Z', lastUsedAt: '2026-10-04T19:12:00.000Z' },
          { device: 'Chrome on Windows', current: false, createdAt: '2026-09-20T07:00:00.000Z', lastUsedAt: '2026-09-29T11:05:00.000Z' },
        ] satisfies SignedInSession[],
        activity: [
          { id: 'a1', occurredAt: '2026-10-05T10:40:00.000Z', action: 'person.signed_in', result: 'success', storeId: null, target: null },
          { id: 'a2', occurredAt: '2026-10-04T16:02:00.000Z', action: 'member.invited', result: 'success', storeId: 's1', target: { type: 'person', label: 'Priya Shah' } },
          { id: 'a3', occurredAt: '2026-10-03T12:20:00.000Z', action: 'person.sign_in_refused', result: 'denied', storeId: null, target: null },
          { id: 'a4', occurredAt: '2026-09-28T09:15:00.000Z', action: 'backup_codes.generated', result: 'success', storeId: null, target: null },
        ] satisfies MyActivityEntry[],
        secret: 'JBSWY3DPEHPK3PXP',
        codes: ['k7pm-2qxd', 'r4tn-8vhc', 'w9fz-3jbe', 'm2gs-6ykq', 'h5dc-7nup', 'x3lv-9rta', 'b8qw-4mfe', 'p6jh-2czs', 'e7rk-5tnw', 'u4xb-8gdl'],
      }
    : null

export const profileSample = (state: ProfileState | null): ProfileSample | null => {
  if (!base || !state || state === 'loading' || state === 'error') return null
  const profile = base.profile
  switch (state) {
    case 'owner':
      return base
    case 'needsSetup':
      return { ...base, profile: { ...profile, twoFactor: { method: null, backupCodesLeft: 0, required: true } } }
    case 'staff':
      return { ...base, profile: { ...profile, twoFactor: { method: null, backupCodesLeft: 0, required: false } } }
    case 'sms':
      return { ...base, profile: { ...profile, twoFactor: { ...profile.twoFactor, method: 'sms' } } }
    case 'lowCodes':
      return { ...base, profile: { ...profile, twoFactor: { ...profile.twoFactor, backupCodesLeft: 2 } } }
    case 'pendingEmail':
      return { ...base, profile: { ...profile, pendingEmail: 'farhan.ali@gmail.com' } }
    case 'setupPick':
    case 'setupApp':
    case 'setupSms':
    case 'setupCodes': {
      const off = { ...base, profile: { ...profile, twoFactor: { method: null, backupCodesLeft: 0, required: true } } }
      if (state === 'setupPick') return { ...off, setup: { step: 'pick', method: 'app', switching: false } }
      if (state === 'setupCodes') return { ...off, setup: { step: 'codes', codes: base.codes } }
      return { ...off, setup: { step: 'verify', method: state === 'setupApp' ? 'app' : 'sms', switching: false, secret: base.secret, hint: '•••• 1234' } }
    }
  }
}
