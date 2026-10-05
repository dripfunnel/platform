// Every word an email says, in English: no partner or store has a language yet, so `en` is the
// only locale (AGENTS.md "Product"). A second locale adds a sibling object of the same shape.

export const en = {
  footer: {
    support: (contact: string) => `Questions? Contact ${contact}.`,
    poweredBy: 'Powered by DripFunnel',
  },
  linkOnce: 'The link works once. If you didn’t expect this email, you can ignore it.',
  roles: {
    'partner-owner': 'Owner',
    'partner-admin': 'Admin',
    'partner-support': 'Support',
    'partner-finance': 'Finance',
    'partner-read-only': 'Read-only',
  },
  staffInvitation: {
    subject: 'You’re invited to the DripFunnel admin console',
    heading: 'Join the DripFunnel admin console',
    body: 'You’ve been invited to the DripFunnel admin console. Accept with your company Microsoft account; that account is then the one you sign in with.',
    action: 'Accept the invitation',
  },
  partnerOwnerInvitation: {
    subject: (partner: string) => `Set up ${partner} on DripFunnel`,
    heading: (partner: string) => `Welcome, ${partner}`,
    body: (partner: string) => `DripFunnel has created ${partner}’s partner console. Accept the invitation to choose your password and turn on 2-factor; you’re the Owner.`,
    action: 'Accept and set your password',
  },
  partnerTeamInvitation: {
    subject: (partner: string) => `Join ${partner} on DripFunnel`,
    heading: (partner: string) => `Join ${partner}`,
    body: (partner: string, role: string) => `You’ve been invited to ${partner}’s partner console as ${role}. Accept the invitation to choose your password and turn on 2-factor.`,
    action: 'Accept and set your password',
  },
  partnerPasswordReset: {
    subject: 'Reset your DripFunnel password',
    heading: 'Reset your password',
    body: 'Someone asked to reset the password for your DripFunnel partner console account. Choose a new one with the link below.',
    action: 'Choose a new password',
    note: 'The link works once, for 30 minutes. If you didn’t ask, ignore this email; your password stays the same.',
  },
  partnerUserLocked: {
    subject: 'Your DripFunnel account is locked for now',
    heading: 'Too many wrong codes',
    body: (minutes: number) => `Your partner console account is locked for ${minutes} minutes after too many wrong 2-factor codes. You can sign in again after that.`,
    notYou: 'If that wasn’t you, reset your password from the sign-in page once the lock ends.',
  },
  userLocked: {
    subject: (brand: string) => `Sign-in to ${brand} is paused`,
    heading: 'Sign-in is paused',
    body: (minutes: number) => `There were five wrong passwords or codes in a row, so sign-in to your account is paused for ${minutes} minutes to keep your stores safe.`,
    notYou: 'If that wasn’t you, reset your password from the sign-in page; it works straight away.',
  },
  partnerDomainLive: {
    subject: (host: string) => `${host} is live`,
    heading: 'Your address is live',
    body: (host: string, kind: string) => `${host} now works as your ${kind}. Nothing more to do.`,
    kinds: { portal: 'portal address', preview: 'preview address', shops: 'shops address', email: 'email sender' },
  },
  partnerCardDeclined: {
    subject: 'DripFunnel couldn’t charge your card',
    heading: 'Your payment didn’t go through',
    body: (card: string) => `DripFunnel couldn’t charge ${card}. Update your card in Settings › Billing so your service continues.`,
    card: (brand: string, last4: string) => `your ${brand} card ending ${last4}`,
    someCard: 'your card',
  },
  partnerPayoutAccountFailed: {
    subject: 'Your payout account couldn’t be verified',
    heading: 'Check your payout account',
    body: (account: string) => `The test deposit to ${account} was returned, so payouts are on hold. Check the details in Settings › Payout and payment.`,
    account: (bank: string, last4: string) => `${bank} ending ${last4}`,
    someAccount: 'your payout account',
  },
  planChangeAtRenewal: {
    subject: (store: string) => `${store} is changing plan`,
    heading: 'Your plan is changing',
    body: (store: string, plan: string, date: string) => `${store} moves to the ${plan} plan on ${date}, at its next renewal.`,
  },
  planRetiredMove: {
    subject: (store: string) => `${store}’s plan is being retired`,
    heading: 'Your plan is being retired',
    body: (store: string, plan: string, date: string) => `The plan ${store} is on is being retired. ${store} moves to the ${plan} plan on ${date}.`,
  },
  storePlanChanged: {
    subject: (store: string) => `${store}’s plan has changed`,
    heading: 'Your plan has changed',
    now: (store: string, plan: string) => `${store} is now on the ${plan} plan.`,
    next: (store: string, plan: string) => `${store} moves to the ${plan} plan at its next renewal.`,
  },
  storeSuspended: {
    subject: (store: string) => `${store} is suspended`,
    heading: 'Your store is suspended',
    body: (store: string) => `${store} is suspended. Shoppers see a notice instead of your storefront, and the portal can be viewed but not changed.`,
    reason: (reason: string) => `Reason: ${reason}`,
    contact: (contact: string) => `To resolve it, contact ${contact}.`,
  },
  storeRestored: {
    subject: (store: string) => `${store} is back`,
    heading: 'Your store is restored',
    body: (store: string) => `${store} is restored. The storefront is live again and the portal works as before.`,
  },
  date: (at: Date) => `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(at)} (UTC)`,
} as const

export type Messages = typeof en
