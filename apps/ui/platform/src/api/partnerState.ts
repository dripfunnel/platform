import { z } from 'zod'
import { query } from './client'
import { partnerStates } from './me'

// The facts behind the shell's strips and banners (FIRST-RELEASE.md §2.3, §16): the console words
// each one from messages/, never from a server sentence.
const factsSchema = z.object({
  partnerState: z.object({
    state: z.enum(partnerStates),
    sentBackReason: z.string().nullable(),
    pausedAt: z.string().nullable(),
    pauseReason: z.string().nullable(),
    storeCount: z.number().int().nonnegative(),
    // Portal or email sender hosts whose records stopped pointing at DripFunnel.
    brokenHosts: z.array(z.string()),
    // A DripFunnel staff member setting the console up, as the partner's team sees it.
    setupSession: z.object({ staffName: z.string(), endsAt: z.string() }).nullable(),
    // Who bills the partner's merchants, which decides what Billing shows (§11.4).
    billingMode: z.enum(['dripfunnel', 'own']),
  }),
})

export type PartnerFacts = z.infer<typeof factsSchema>['partnerState']

export const loadPartnerFacts = async (): Promise<PartnerFacts> =>
  (await query(`{ partnerState { state sentBackReason pausedAt pauseReason storeCount brokenHosts billingMode setupSession { staffName endsAt } } }`, factsSchema)).partnerState
