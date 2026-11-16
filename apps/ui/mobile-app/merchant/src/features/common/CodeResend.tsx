import { useEffect } from 'react'
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native'
import type { CodeChannel, CodeChannels } from '../../api/auth'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { LinkButton } from './LinkButton'
import { linkLabel, sentText, type SentCode } from './codeSend'

type Props = {
  /** Null while no code has gone (the first send was refused): the links alone, to ask for one. */
  sent: SentCode | null
  channels: CodeChannels
  wait: number
  busy?: boolean
  onSend: (channel: CodeChannel) => void
}

/**
 * Where the code went and, after the wait, "Send again on WhatsApp" and, while SMS is open, "Send by SMS instead"
 * (ACCESS.md §4): one block for the sign-in code and My profile's phone set-up.
 */
export function CodeResend({ sent, channels, wait, busy = false, onSend }: Props) {
  const { colors } = useTheme()
  const offers = (['whatsapp', 'sms'] as const).filter((channel) => channels[channel])
  const waiting = wait > 0
  // The countdown itself is silent: its start and its end are announced once each, after what is being read (WCAG 4.1.3).
  const announcement = waiting ? [sent ? sentText(sent) : null, t('codeResend.waiting')].filter(Boolean).join(' ') : offers.length > 0 ? t('codeResend.readyAnnounced') : null
  useEffect(() => {
    if (announcement) AccessibilityInfo.announceForAccessibilityWithOptions(announcement, { queue: true })
  }, [announcement])

  return (
    <View style={styles.box}>
      {sent ? <Text style={[styles.sent, { color: colors.text }]}>{sentText(sent)}</Text> : null}
      {waiting ? <Text style={[styles.note, { color: colors.muted }]}>{t('codeResend.wait', { seconds: wait })}</Text> : null}
      {!waiting && offers.length > 0 ? (
        <>
          {sent ? <Text style={[styles.note, { color: colors.muted }]}>{t('codeResend.ready')}</Text> : null}
          {offers.map((channel) => (
            <LinkButton key={channel} label={linkLabel(channel, sent?.channel ?? null)} disabled={busy} onPress={() => onSend(channel)} />
          ))}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 2 },
  sent: { fontSize: 14, lineHeight: 21 },
  note: { fontSize: 13, lineHeight: 18 },
})
