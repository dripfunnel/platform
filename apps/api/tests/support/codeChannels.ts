import { smsMessages } from '#core/sms'
import { codeChannelsFor } from '#saas/portalCodes/index'
import { smsAccountsFor, type OurSmsRoutes } from '#saas/sms/index'
import { whatsappSendsCodes, whatsappTemplates, type PartnerWhatsAppAccount } from '#saas/whatsapp/index'

// DripFunnel's own SMS account on both routes and its WhatsApp, as the local stand-in's (index.ts smsFor), open to every
// partner as if Admin enabled them (#1543): SMS reaches every number while the partner's SMS is on, and WhatsApp follows
// the partner's switch (ACCESS.md §4).
const ours: OurSmsRoutes = {
  india: { provider: 'msg91', authKey: 'test', templates: Object.fromEntries(smsMessages.map((m) => [m, 'test'])) },
  rest: { provider: 'twilio', accountSid: 'test', authToken: 'test', messagingServiceSid: 'test' },
}
const ourWhatsApp: PartnerWhatsAppAccount = { accessToken: 'test', businessAccountId: '00000', phoneNumberId: '00000', language: 'en', templates: Object.fromEntries(whatsappTemplates.map((m) => [m, m.replace('.', '_')])) }

export const testOurWhatsApp = async () => ({ settings: ourWhatsApp, open: async () => ourWhatsApp })

export const testCodeChannels = codeChannelsFor(
  smsAccountsFor(null, async () => ours),
  (tx, partnerId) => whatsappSendsCodes(tx, null, testOurWhatsApp, partnerId),
)
