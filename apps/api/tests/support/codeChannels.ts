import { smsMessages } from '#core/sms'
import { codeChannelsFor } from '#saas/portalCodes/index'
import { smsAccountsFor, type OurSmsRoutes } from '#saas/sms/index'

// DripFunnel's own SMS account on both routes, as the local stand-in's (index.ts smsFor): SMS reaches every number while the
// partner's SMS is on, and WhatsApp follows the partner's switch (ACCESS.md §4).
const ours: OurSmsRoutes = {
  india: { provider: 'msg91', authKey: 'test', templates: Object.fromEntries(smsMessages.map((m) => [m, 'test'])) },
  rest: { provider: 'twilio', accountSid: 'test', authToken: 'test', messagingServiceSid: 'test' },
}

export const testCodeChannels = codeChannelsFor(smsAccountsFor(null, ours))
