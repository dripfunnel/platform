import { useCallback, useEffect, useState } from 'react'
import type { CodeChannel, CodeChannels } from '../../api/auth'
import { fill, messages } from '../../messages'
import './codeResend.css'

const words = messages.codeResend

/** How long a code screen waits before offering another code: SMS after WhatsApp waits this long on the server too (ACCESS.md §4). */
export const resendWaitSeconds = 20

/** Seconds until another code may be asked for, counted down once a second; the server's `seconds` when it says TOO_SOON. */
export const useResendWait = (): [number, (seconds?: number) => void] => {
  const [wait, setWait] = useState(0)
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])
  const start = useCallback((seconds: number = resendWaitSeconds) => setWait(seconds), [])
  return [wait, start]
}

export interface SentCode {
  channel: CodeChannel
  /** The number's last four, `•••• 1234`, never the number. */
  hint: string
}

export const noCodeChannels: CodeChannels = { whatsapp: false, sms: false }

/** Before the API has said (a resumed step): both, and a closed one is dropped when its send is refused CHANNEL_OFF. */
export const unknownCodeChannels: CodeChannels = { whatsapp: true, sms: true }

const linkLabel = (channel: CodeChannel, last: CodeChannel | null): string => {
  if (last === null) return channel === 'whatsapp' ? words.sendWhatsapp : words.sendSms
  if (channel === 'whatsapp') return last === 'whatsapp' ? words.againWhatsapp : words.insteadWhatsapp
  return last === 'sms' ? words.againSms : words.insteadSms
}

export interface CodeResendProps {
  /** Null while no code has gone (the first send was refused): the links alone, to ask for one. */
  sent: SentCode | null
  channels: CodeChannels
  wait: number
  busy?: boolean | undefined
  onSend: (channel: CodeChannel) => void
}

/**
 * Where the code went and, after the wait, "Send again on WhatsApp" and, while SMS is open, "Send by SMS instead"
 * (ACCESS.md §4): one panel for sign-up's number, the sign-in code and the phone set-up.
 */
export const CodeResend = ({ sent, channels, wait, busy, onSend }: CodeResendProps) => {
  const offers = (['whatsapp', 'sms'] as const).filter((channel) => channels[channel])
  return (
    <div className="df-code-resend">
      {sent && (
        <p role="status" className="df-code-resend-sent">
          {fill(sent.channel === 'whatsapp' ? words.sentWhatsapp : words.sentSms, { hint: sent.hint })}
        </p>
      )}
      {wait > 0 ? (
        <p className="df-code-resend-wait" aria-hidden="true">
          {fill(words.wait, { seconds: String(wait) })}
        </p>
      ) : (
        offers.length > 0 && (
          <p className="df-code-resend-links">
            {sent && <span>{words.ready}</span>}
            {offers.map((channel) => (
              <button key={channel} type="button" className="df-code-resend-link" disabled={busy} onClick={() => onSend(channel)}>
                {linkLabel(channel, sent?.channel ?? null)}
              </button>
            ))}
          </p>
        )
      )}
      {/* The countdown itself is silent: its start and its end are announced once each (WCAG 4.1.3). */}
      <span role="status" className="df-visually-hidden">
        {wait > 0 ? words.waiting : offers.length > 0 ? words.readyAnnounced : ''}
      </span>
    </div>
  )
}

export interface RefusedSend {
  code: string
  seconds?: number | undefined
}

/**
 * What a refused send changes: TOO_SOON waits the server's seconds; CHANNEL_OFF closes the channel asked for, or both
 * when none was (the default goes by whichever is open). Anything else is the screen's to word.
 */
export const afterRefusedSend = (refusal: RefusedSend, asked: CodeChannel | undefined, channels: CodeChannels, noneLeft: string): { text: string; wait: number | null; channels: CodeChannels } | null => {
  if (refusal.code === 'TOO_SOON') {
    const seconds = refusal.seconds ?? resendWaitSeconds
    return { text: fill(words.tooSoon, { seconds: String(seconds) }), wait: seconds, channels }
  }
  if (refusal.code !== 'CHANNEL_OFF') return null
  const left = asked ? { ...channels, [asked]: false } : noCodeChannels
  const other = asked === 'whatsapp' ? 'sms' : 'whatsapp'
  return { text: asked && left[other] ? words.off[asked] : noneLeft, wait: null, channels: left }
}
