import { parseScreenState } from '@dripfunnel/shared/ui'
import { z } from 'zod'
import { partnerRoles, type PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'
import { query } from './client'

// The partner's state as the console shows it (SAAS §3.1): Sent back is Draft with a reason, and a
// closed partner has no session at all (apps/api src/auth/partnerCaller.ts).
export const partnerStates = ['live', 'draft', 'awaiting', 'sentback', 'paused', 'offboarding'] as const

export type PartnerState = (typeof partnerStates)[number]

const meSchema = z.object({
  me: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(partnerRoles),
      // `host` is null until the partner's portal address is set (FIRST-RELEASE §9.1).
      partner: z.object({ id: z.string(), name: z.string(), product: z.string(), host: z.string().nullable(), state: z.enum(partnerStates) }),
    })
    .nullable(),
})

export type Me = NonNullable<z.infer<typeof meSchema>['me']>

// `me` is null when nobody is signed in (apps/api src/apis/platform/schema.ts); the shell then
// sends the visitor to /sign-in.
export const loadMe = async (): Promise<Me | null> =>
  (await query(`{ me { id name email role partner { id name product host state } } }`, meSchema)).me

// ?state=readonly|denied ask for a caller without the permissions: what is allowed is the API's
// answer, never the screen's (decided on #19).
const viewAs: Partial<Record<string, PartnerRole>> = { readonly: 'partner-read-only', denied: 'partner-support' }

export const callerFor = (role: PartnerRole, state: string | undefined): PartnerRole => {
  if (!harnessEnabled) return role
  const forced = parseScreenState(state, ['readonly', 'denied'] as const)
  return (forced && viewAs[forced]) ?? role
}

// ?partner=… shows the console as a partner in that state sees it (FIRST-RELEASE §2.3, §4), the
// way the prototype's Partner control does: its pre-Live partner is Kaufladen Digital. Only in a
// harness build: Vite folds the condition, so production carries no sample.
const kaufladen =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? { id: 'p-kaufladen', name: 'Kaufladen Digital', product: 'Kaufladen Shops', host: 'shop.kaufladen.de' }
    : null

const preLive = ['draft', 'awaiting', 'sentback'] as const

// Before approval Home is the checklist and screens that need merchants are empty (FIRST-RELEASE §1, §4).
export const isPreLive = (state: PartnerState): state is (typeof preLive)[number] => (preLive as readonly PartnerState[]).includes(state)

export const meForPartnerState = (me: Me, requested: string | undefined): Me => {
  const state = harnessEnabled ? parseScreenState(requested, partnerStates) : null
  if (!state || state === me.partner.state) return me
  return isPreLive(state) && kaufladen ? { ...me, partner: { ...kaufladen, state } } : { ...me, partner: { ...me.partner, state } }
}
