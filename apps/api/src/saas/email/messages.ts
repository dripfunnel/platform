import { toMajor } from '#core/money'

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
  storeInvitation: {
    subject: (store: string) => `You’re invited to ${store}`,
    heading: (store: string) => `Join ${store}`,
    // The prototype's invite screen words the role the same way (PortalAuth `invite`).
    roles: {
      owner: 'an Owner',
      manager: 'a Manager',
      staff: 'Staff',
      supplier: (seller: string) => `a supplier for ${seller}`,
    },
    newPerson: (inviter: string, store: string, role: string) => `${inviter} invited you to ${store} as ${role}. Accept to choose your password and open the store.`,
    existingPerson: (inviter: string, store: string, role: string) => `${inviter} invited you to ${store} as ${role}. Sign in with the account you already have to accept.`,
    actionNew: 'Accept and set your password',
    actionJoin: 'Sign in to accept',
    note: 'The link works for 7 days. If you didn’t expect this email, you can ignore it.',
  },
  userPasswordReset: {
    subject: (brand: string) => `Reset your ${brand} password`,
    heading: 'Reset your password',
    body: (brand: string) => `Someone asked to reset the password for your ${brand} account. Choose a new one with the link below; you’ll be signed out everywhere else.`,
    action: 'Choose a new password',
    note: 'The link works once, for 30 minutes. If you didn’t ask, ignore this email; your password stays the same.',
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
  signupCode: {
    subject: (brand: string) => `Your ${brand} sign-up code`,
    heading: 'Check it’s you',
    body: (code: string) => `Your code is ${code}. Type it on the sign-up page to carry on. It works for 10 minutes.`,
    note: 'If you didn’t start a sign-up, ignore this email; nothing is made without the code.',
  },
  shopperCode: {
    subject: (store: string) => `Your ${store} code`,
    heading: 'Your code',
    body: (code: string) => `Your code is ${code}. Type it where you asked for it to carry on. It works for 10 minutes.`,
    note: 'If you didn’t ask for a code, ignore this email; nothing happens without it.',
  },
  signupHasAccount: {
    subject: (brand: string) => `You already have a ${brand} account`,
    heading: 'You already have an account',
    body: (brand: string) => `Someone started a new ${brand} sign-up with this address, which already has an account. Sign in instead; you can create another store from there.`,
    action: 'Sign in',
    note: 'If that wasn’t you, ignore this email; nothing has changed.',
  },
  userEmailChange: {
    subject: (brand: string) => `Confirm your new ${brand} email`,
    heading: 'Confirm your new email',
    body: (brand: string) => `Someone asked to use this address for their ${brand} account. Confirm it with the link below and it becomes the address you sign in with.`,
    action: 'Confirm this email',
    note: 'The link works once, for 24 hours. If you didn’t ask, ignore this email; nothing changes.',
  },
  userEmailChanging: {
    subject: (brand: string) => `Your ${brand} email is about to change`,
    heading: 'Your email is about to change',
    body: (brand: string) => `Someone asked to move your ${brand} account to a new address. It changes only when the link sent there is clicked.`,
    notYou: 'If that wasn’t you, sign in, change your password and sign out everywhere else; the request then can’t be confirmed without the new mailbox.',
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
  supportStarted: {
    subject: (partner: string, store: string) => `${partner} support opened ${store}`,
    heading: 'Support is viewing your store',
    body: (agent: string, partner: string, store: string, user: string) =>
      `${agent} from ${partner} support opened a read-only support session in ${store}, signed in as ${user}. It ends after 30 minutes, and everything they open is in your Activity log.`,
    reason: (reason: string) => `Reason: ${reason}`,
    ticket: (ticket: string) => `Ticket: ${ticket}`,
    control: 'To end it, and stop new ones, turn off support access in Settings › Support access.',
  },
  supportWriteAllowed: {
    subject: (store: string) => `Support can make changes in ${store}`,
    heading: 'Support can make changes',
    body: (by: string, agent: string, partner: string, store: string) =>
      `${by} let ${agent} from ${partner} support make changes in ${store} for the rest of this support session. Passwords, payment details, payouts and who works here stay locked.`,
    control: 'To end the session now, turn off support access in Settings › Support access.',
  },
  storeSuspended: {
    subject: (store: string) => `${store} is suspended`,
    heading: 'Your store is suspended',
    body: (store: string) => `${store} is suspended. Shoppers see a notice instead of your storefront, and the portal can be viewed but not changed.`,
    reason: (reason: string) => `Reason: ${reason}`,
    contact: (contact: string) => `To resolve it, contact ${contact}.`,
    // Dunning's reason (SAAS §7.3): a suspended store can't pay in the portal, so it names no way to but support.
    unpaid: 'The plan has been unpaid for 14 days.',
  },
  storeCancelled: {
    subject: (store: string) => `${store} is closing`,
    heading: 'Your store is closing',
    body: (store: string, date: string) => `You closed ${store}. Shoppers can buy until ${date}; then the storefront goes offline. The portal can be viewed but not changed.`,
    // Decided on #337: data, assets and the repo are kept 90 days, with the export offered.
    data: 'Your products, orders and customers are kept for 90 days. Download them from Billing before then.',
  },
  storeRestored: {
    subject: (store: string) => `${store} is back`,
    heading: 'Your store is restored',
    body: (store: string) => `${store} is restored. The storefront is live again and the portal works as before.`,
  },
  webhookDisabled: {
    subject: (store: string) => `A webhook for ${store} is turned off`,
    heading: 'We turned off a webhook',
    body: (host: string, store: string) =>
      `Deliveries to ${host} for ${store} have failed for 3 days, so we turned it off. Nothing was lost: its events wait 7 days. Fix the server, then turn it back on in Settings › Developers to send them.`,
  },
  apiKeysCreatorGone: {
    subject: (store: string) => `API keys in ${store} need a look`,
    heading: 'API keys made by someone who has left',
    body: (who: string, keys: number, store: string) =>
      `${who} is no longer an Owner of ${store}. ${keys === 1 ? 'The API key they made keeps' : `The ${keys} API keys they made keep`} working, because keys belong to the store. Check them in Settings › Developers, and revoke any you don’t need.`,
  },
  orderConfirmed: {
    subject: (store: string, order: string) => `Your ${store} order ${order}`,
    heading: 'Thanks for your order',
    intro: (order: string) => `We have your order ${order}:`,
    line: (quantity: number, item: string, amount: string) => `${quantity} × ${item}: ${amount}`,
    total: (amount: string) => `Total: ${amount}`,
    cod: (amount: string) => `You pay ${amount} when it arrives.`,
    transfer: 'We’ll send it once your bank transfer arrives.',
    shipTo: (name: string, city: string) => `It goes to ${name} in ${city}. We’ll email you when it’s on its way.`,
  },
  orderShipped: {
    subject: (store: string, order: string) => `Your ${store} order ${order} is on its way`,
    heading: 'It’s on its way',
    intro: (order: string) => `These items from order ${order} have left:`,
    line: (quantity: number, item: string) => `${quantity} × ${item}`,
    courier: (courier: string, tracking: string) => `With ${courier}, tracking number ${tracking}.`,
    tracking: (tracking: string) => `Tracking number ${tracking}.`,
    action: 'Track your parcel',
  },
  orderDelivered: {
    subject: (store: string, order: string) => `Your ${store} order ${order} was delivered`,
    heading: 'It’s arrived',
    intro: (order: string) => `The courier delivered these items from order ${order}:`,
    line: (quantity: number, item: string) => `${quantity} × ${item}`,
  },
  // The store's own subject and message come first; these are the parts added for it (Carts' preview).
  cartReminder: {
    greeting: (name: string | null) => (name ? `Hi ${name},` : 'Hi,'),
    line: (quantity: number, item: string, amount: string | null) => (amount ? `${quantity} × ${item}: ${amount}` : `${quantity} × ${item}`),
    code: (code: string, percent: number) => `Use ${code} for ${percent}% off your cart. It works once, for 48 hours, and is added for you when you go back.`,
    action: 'Return to your cart',
    why: (host: string) => `You’re getting this because you started checkout at ${host}.`,
    unsubscribe: (url: string) => `Unsubscribe: ${url}`,
    testSubject: (subject: string) => `[Test] ${subject}`,
    test: 'This is a test of your cart reminder, with a sample cart. Its code works at no checkout.',
  },
  money: (locale: string, amount: string, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(toMajor({ amount: BigInt(amount), currency }) as `${number}`),
  date: (at: Date) => `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(at)} (UTC)`,
} as const

export type Messages = typeof en
