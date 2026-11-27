import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import type { AiProvider } from '#db/schema/saas'
import type { StripeApi } from '#integrations/stripe/index'
import type { StoreBillingStripe } from '#integrations/stripe/subscriptions'
import { createPartnerBillingService, createPartnerRazorpayService } from '#saas/billing/index'
import { razorpayBilling, type RazorpayBilling } from '#integrations/payments/index'
import { createPartnerActivityService } from '#saas/partnerActivity/index'
import { createPartnerBrandingService } from '#saas/partnerBranding/index'
import { createPartnerConsoleService } from '#saas/partnerConsole/index'
import { createPartnerDashboardService } from '#saas/partnerDashboard/index'
import { createPartnerCredentialsService, createPartnerMapsService, createPartnerSmsService, createPartnerWhatsAppService } from '#saas/partnerCredentials/index'
import type { MapsKeyCheck } from '#core/mapsKey'
import type { SmsAccountCheck } from '#core/sms'
import type { WhatsAppAccountCheck } from '#core/whatsapp'
import { checkMetaWhatsAppAccount } from '#integrations/meta/index'
import { checkSmsAccount, type OurSms, type PartnerSmsAccount } from '#saas/sms/index'
import type { OurWhatsApp, PartnerWhatsAppAccount } from '#saas/whatsapp/index'
import { createGoogleSignInService } from '#saas/googleSignIn/index'
import { createPartnerProfileService } from '#saas/partnerProfile/index'
import { createPartnerDomainsService } from '#saas/partnerDomains/index'
import { checkAnthropicKey, openaiChat, type KeyCheck } from '#integrations/ai/index'
import type { AiOAuth } from '#saas/aiOAuth/index'
import { createPartnerPlansService } from '#saas/partnerPlans/index'
import { createPartnerReportsService } from '#saas/partnerReports/index'
import { createPartnerStoreActions, createPartnerStoresService } from '#saas/partnerStores/index'
import { createPartnerTeamService } from '#saas/partnerTeam/index'
import { createPartnerSupportService } from '#saas/support/index'
import type { PlatformContext } from './access'

export interface PlatformContextDeps {
  sql: postgres.Sql
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  // DripFunnel's Stripe account; null until its keys are Worker secrets (THIRD-PARTY-ACCESS §2.7).
  stripe: StripeApi | null
  // The `pk_` the console's Stripe.js acts with (#278); absent while it is unset.
  stripePublishableKey?: string | null
  edgeZone: string
  /** The domain of every store's free address (SHOP_DOMAIN); null where none is set. */
  shopDomain: string | null
  /** `*.localhost` partner domains, where the local DNS stand-in answers them (DNS_LOCAL). */
  localHosts?: boolean
  /** The AI sign-in flow (SAAS §9.3); absent where the Worker has none. */
  aiOauth?: AiOAuth | null
  now: () => Date
  /** This request's partner session cookie; My profile's password change keeps it (#1053). */
  sessionId?: string | null
  /** Ends an archived store's live subscription (#1056). */
  billingStripe?: Pick<StoreBillingStripe, 'cancelNow'> | null
  /** Checks a partner's SMS account; locally (SMS_LOCAL) the stand-in's. */
  checkSms?: (account: PartnerSmsAccount) => Promise<SmsAccountCheck>
  /** Checks a partner's WhatsApp account with Meta; locally (SMS_LOCAL) the stand-in's. */
  checkWhatsApp?: (account: PartnerWhatsAppAccount) => Promise<WhatsAppAccountCheck>
  /** Checks a Google Maps key against Google (#1612); absent, Google can't be asked and nothing is saved. */
  checkMaps?: (key: string) => Promise<MapsKeyCheck>
  /** DripFunnel's SMS and WhatsApp as each partner may use them (#1543); absent, none. */
  ourSms?: OurSms
  ourWhatsApp?: OurWhatsApp
  /** Where the partner's Razorpay webhook address is (HOOKS_HOST), and the Razorpay calls; tests pass a stand-in (#1744). */
  hooksHost?: string
  razorpay?: RazorpayBilling
}

/** Every key is tested before it is saved: OpenAI's against OpenAI, a DeepInfra key (`sk-di-`) against DeepInfra. */
const checkAiKey = (provider: AiProvider, key: string): Promise<KeyCheck | null> =>
  provider === 'anthropic' ? checkAnthropicKey(key) : openaiChat(key).validateCredentials()

export const signedOutContext: PlatformContext = { caller: null, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, credentials: null, googleSignIn: null, sms: null, whatsapp: null, maps: null, profile: null, activity: null, team: null, reports: null, support: null, billing: null, razorpay: null }

/** Every Platform API service for the caller, whichever kind it is (#243). */
export const platformContextFor = (caller: PartnerCaller | null, { secrets, stripe, stripePublishableKey = null, localHosts = false, aiOauth = null, sessionId = null, billingStripe = null, checkSms = checkSmsAccount, checkWhatsApp = checkMetaWhatsAppAccount, checkMaps = async () => ({ status: 'unavailable' }), ourSms = async () => ({}), ourWhatsApp = async () => null, hooksHost = 'hooks.localhost', razorpay = razorpayBilling(), ...base }: PlatformContextDeps): PlatformContext => {
  if (!caller) return signedOutContext
  const deps = { ...base, caller }
  return {
    caller,
    console: createPartnerConsoleService(deps),
    plans: createPartnerPlansService(deps),
    branding: createPartnerBrandingService(deps),
    stores: createPartnerStoresService(deps),
    storeActions: createPartnerStoreActions({ ...deps, billingStripe }),
    dashboard: createPartnerDashboardService(deps),
    domains: createPartnerDomainsService({ ...deps, localHosts }),
    credentials: createPartnerCredentialsService({ ...deps, secrets, checkKey: checkAiKey, oauth: aiOauth }),
    googleSignIn: createGoogleSignInService({ ...deps, secrets }),
    sms: createPartnerSmsService({ ...deps, secrets, checkSms, ourSms }),
    whatsapp: createPartnerWhatsAppService({ ...deps, secrets, checkWhatsApp, ourWhatsApp }),
    maps: createPartnerMapsService({ ...deps, secrets, checkMaps }),
    profile: createPartnerProfileService({ ...deps, sessionId }),
    activity: createPartnerActivityService(deps),
    team: createPartnerTeamService(deps),
    reports: createPartnerReportsService(deps),
    // A partner user's own; no staff session reaches it (apis/platform/support.ts).
    support: caller.user && !caller.staff ? createPartnerSupportService({ ...deps, user: caller.user, secrets }) : null,
    billing: createPartnerBillingService({ ...deps, stripe, publishableKey: stripePublishableKey }),
    razorpay: createPartnerRazorpayService({ ...deps, secrets, api: razorpay, hooksHost }),
  }
}
