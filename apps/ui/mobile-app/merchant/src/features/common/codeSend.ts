import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import type { CodeChannel, CodeChannels } from '../../api/auth'
import { t } from '../../messages'

/** How long a code screen waits before offering another code: SMS after WhatsApp waits as long on the server (ACCESS.md §4). */
export const resendWaitSeconds = 20

export type SentCode = { channel: CodeChannel; hint: string }

export const noCodeChannels: CodeChannels = { whatsapp: false, sms: false }

/** Before the API has said: both, and a closed one is dropped when its send is refused CHANNEL_OFF. */
export const unknownCodeChannels: CodeChannels = { whatsapp: true, sms: true }

export const sentText = (sent: SentCode): string => t(sent.channel === 'whatsapp' ? 'codeResend.sentWhatsapp' : 'codeResend.sentSms', { hint: sent.hint })

export const linkLabel = (channel: CodeChannel, last: CodeChannel | null): string => {
  if (last === null) return t(channel === 'whatsapp' ? 'codeResend.sendWhatsapp' : 'codeResend.sendSms')
  if (channel === 'whatsapp') return t(last === 'whatsapp' ? 'codeResend.againWhatsapp' : 'codeResend.insteadWhatsapp')
  return t(last === 'sms' ? 'codeResend.againSms' : 'codeResend.insteadSms')
}

export type RefusedSend = { text: string; wait: number | null; channels: CodeChannels }

/**
 * What a refused send changes: TOO_SOON waits the server's seconds; CHANNEL_OFF closes the channel asked for, or both
 * when none was (the default goes by whichever is open). Anything else is null, for the screen to word.
 */
export const afterRefusedSend = (error: unknown, asked: CodeChannel | undefined, channels: CodeChannels, noneLeft: string): RefusedSend | null => {
  if (isApiError(error, 'TOO_SOON')) {
    const seconds = typeof error.details.seconds === 'number' ? error.details.seconds : resendWaitSeconds
    return { text: t('codeResend.tooSoon', { seconds }), wait: seconds, channels }
  }
  if (!isApiError(error, 'CHANNEL_OFF')) return null
  const left: CodeChannels = asked ? { ...channels, [asked]: false } : noCodeChannels
  const other: CodeChannel = asked === 'whatsapp' ? 'sms' : 'whatsapp'
  const text = asked && left[other] ? t(asked === 'whatsapp' ? 'codeResend.off.whatsapp' : 'codeResend.off.sms') : noneLeft
  return { text, wait: null, channels: left }
}
