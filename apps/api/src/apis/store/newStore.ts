import type { RequestFacts } from '#auth/activity'
import { holdForEnrolment, readUserSession } from '#auth/storeSession'
import { countryOf } from '#core/countries'
import { withSystemScope } from '#db/scoped/index'
import { countStoresCreatedSince, selectOwnNewStore, selectPartnerState } from '#db/scoped/signup'
import { selectUserSecondFactor } from '#db/scoped/userSignIn'
import { provisionStore, type FailAt } from '#saas/provisioning/index'
import { withSession, type StoreAuthDeps } from './admission'
import { json, readBody, refuse } from './authHttp'
import { checkStoreStep, isRefusal, offeredCountries, refuseSignup, startsPerPartnerPerHour, storeInput, suggestionsFor, type SignupRefusal } from './signup'

// "Create another store" (FIRST-RELEASE §4, PortalAuth `pick` → su3; #1136): a signed-in person opens a
// store under this partner as its Owner, on sign-up's store step, with no new account and no texted code.

/** A retry within this long answers the store it already made instead of "taken". */
const retryMs = 10 * 60_000

/** What the store step offers a signed-in person: the partner's countries and the free address's domain. */
export const newStoreOptions = async (deps: StoreAuthDeps, sessionId: string | null, inSupport: boolean): Promise<Response> => {
  if (inSupport) return refuse({ code: 'FORBIDDEN' })
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<SignupRefusal | { countries: Awaited<ReturnType<typeof offeredCountries>> }> => {
    if (!sessionId || !(await readUserSession(tx, sessionId, deps.partnerId, deps.now()))) return { code: 'INVALID_CREDENTIALS' }
    if ((await selectPartnerState(tx, deps.partnerId)) !== 'live') return { code: 'SIGNUP_CLOSED' }
    return { countries: await offeredCountries(tx, deps.partnerId) }
  })
  return isRefusal(outcome) ? refuseSignup(outcome) : json(200, { ok: true, countries: outcome.countries, shopDomain: deps.shopDomain ?? null })
}

/** Makes the store in one transaction (SAAS.md §5 steps 1–3); an Owner without 2-factor is then held at enrolment (ACCESS.md §4). */
export const createAnotherStore = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts, sessionId: string | null, inSupport: boolean, failAt?: FailAt): Promise<Response> => {
  if (inSupport) return refuse({ code: 'FORBIDDEN' })
  const input = await readBody(request, storeInput)
  if (!input) return refuse({ code: 'INVALID_INPUT' })
  const now = deps.now()
  const user = sessionId ? await withSystemScope(deps.sql, (tx) => readUserSession(tx, sessionId, deps.partnerId, now)) : null
  if (!sessionId || !user) return refuse({ code: 'INVALID_CREDENTIALS' })
  if (!(await deps.allowAttempt(`store:${deps.host}:new-store:${user.userId}`))) return refuse({ code: 'RATE_LIMITED' })
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<SignupRefusal | { storeId: string; enrol: boolean }> => {
    if (!(await readUserSession(tx, sessionId, deps.partnerId, now))) return { code: 'INVALID_CREDENTIALS' }
    if ((await selectPartnerState(tx, deps.partnerId)) !== 'live') return { code: 'SIGNUP_CLOSED' }
    const again = await selectOwnNewStore(tx, deps.partnerId, user.userId, input.subdomain.trim(), new Date(now.getTime() - retryMs))
    if (again) return { storeId: again, enrol: false }
    if ((await countStoresCreatedSince(tx, deps.partnerId, new Date(now.getTime() - 60 * 60_000))) >= startsPerPartnerPerHour) return { code: 'RATE_LIMITED' }
    const store = await checkStoreStep(tx, deps.partnerId, input, null)
    if (isRefusal(store)) return store
    const country = countryOf(store.country)
    if (!country) return { code: 'COUNTRY_UNAVAILABLE' }
    const made = await provisionStore(tx, { partnerId: deps.partnerId, owner: { userId: user.userId }, store: { name: store.storeName, code: store.subdomain, country: country.code, currency: country.currency } }, now, failAt)
    if (!made.ok) return made.reason === 'SUBDOMAIN_TAKEN' ? { code: 'SUBDOMAIN_TAKEN', suggestions: await suggestionsFor(tx, store.subdomain, null) } : { code: 'COUNTRY_UNAVAILABLE' }
    await deps.activity.record(tx, {
      category: 'auth',
      action: 'store.created',
      result: 'success',
      actorKind: 'person',
      actorId: user.userId,
      actorLabel: null,
      partnerId: deps.partnerId,
      storeId: made.storeId,
      target: { type: 'store', id: made.storeId, label: store.storeName },
      reason: 'another_store',
      api: 'store',
      visibility: 'store',
      ...facts,
    })
    const state = await selectUserSecondFactor(tx, user.userId)
    const enrol = !!state && state.is_owner && state.two_factor_method === null
    if (enrol) await holdForEnrolment(tx, sessionId, now)
    return { storeId: made.storeId, enrol }
  })
  if (isRefusal(outcome)) return refuseSignup(outcome)
  const body = { ok: true, step: outcome.enrol ? 'enrol' : 'done', storeId: outcome.storeId }
  return outcome.enrol ? withSession(request, body, { id: sessionId, remember: false, stage: 'enrol' }) : json(200, body)
}
