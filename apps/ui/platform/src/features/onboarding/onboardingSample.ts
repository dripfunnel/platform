import type { Onboarding } from '../../api/onboarding'

// An `onboarding` answer for the tests, as the Platform API sends it: Kaufladen half set up.
export const sampleOnboarding = (change: Partial<Onboarding> = {}): Onboarding => ({
  items: [
    { key: 'company', status: 'done', detail: 'Kaufladen Digital GmbH, Berlin', doneBy: 'DripFunnel', to: '/settings' },
    { key: 'branding', status: 'done', detail: 'Logo, colours and font saved', doneBy: 'Jonas', to: '/branding' },
    { key: 'portalHost', status: 'progress', detail: 'shop.kaufladen.de: waiting for DNS', doneBy: null, to: '/domains' },
    { key: 'wildcards', status: 'progress', detail: null, doneBy: null, to: '/domains' },
    { key: 'emailSender', status: 'progress', detail: null, doneBy: null, to: '/domains' },
    { key: 'plan', status: 'missing', detail: '3 plans, none priced yet', doneBy: null, to: '/plans' },
    { key: 'legal', status: 'missing', detail: null, doneBy: null, to: '/branding' },
    { key: 'paymentMethod', status: 'missing', detail: null, doneBy: null, to: '/settings' },
    { key: 'payoutDetails', status: 'missing', detail: null, doneBy: null, to: '/settings' },
  ],
  checks: { portalHost: false, emailDomain: true, pricedPlan: false, legalPages: false },
  fallbackSenderAccepted: true,
  submittedAt: null,
  submittedBy: null,
  sentBackReason: null,
  fixes: [],
  canSubmit: { allowed: true, reason: null },
  ...change,
})

export const allChecksPass = { portalHost: true, emailDomain: true, pricedPlan: true, legalPages: true }
