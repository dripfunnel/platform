import { useRef, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { requestLimit } from '../../../api/storefront'
import type { DesignMessage } from '../../../api/studio'
import { t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { Notice } from '../../common/Notice'
import { TextField } from '../../common/TextField'
import { noteText, sampleAddress } from './studioRules'

type Props = {
  /** Newest first, as the API answers. */
  messages: readonly DesignMessage[]
  loading: boolean
  loadFailed: boolean
  assistant: string
  templateName: (key: string) => string
  /** The studio takes no change now: the sandbox isn't ready, a publish runs, or a change is being made. */
  disabled: boolean
  asking: boolean
  failure: string | null
  undoing: string | null
  /** Resolves true once the request was taken, so the composer empties only then. */
  onAsk: (text: string, sampleUrl: string | null) => Promise<boolean>
  onUndo: (messageId: string) => void
  /** Publish's notices, in the conversation where the web studio puts them. */
  children?: ReactNode
}

const suggestions = [0, 1, 2, 3] as const

// "Design with AI" at phone width (PortalStorefront › studio, Chat): the conversation, up to four suggestions and the composer with words and a
// website to take inspiration from. A picture in the chat is not on the phone (decided on #513).
export function StudioChat({ messages, loading, loadFailed, assistant, templateName, disabled, asking, failure, undoing, onAsk, onUndo, children }: Props) {
  const { colors, radii } = useTheme()
  const scroller = useRef<ScrollView>(null)
  const [text, setText] = useState('')
  const [site, setSite] = useState<string | null>(null)
  const [siteProblem, setSiteProblem] = useState(false)

  const send = async () => {
    if (disabled) return
    const address = site === null ? null : sampleAddress(site)
    if (site !== null && address === null) return setSiteProblem(true)
    const asked = text.trim() === '' && address !== null ? t('storefront.studio.chat.attachedOnly') : text.trim()
    if (asked === '') return
    if (await onAsk(asked, address)) {
      setText('')
      setSite(null)
      setSiteProblem(false)
    }
  }

  const chronological = [...messages].reverse()
  return (
    <View style={styles.pane}>
      <ScrollView ref={scroller} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
        {loading ? <Text style={[styles.hint, { color: colors.muted }]}>{t('storefront.studio.chat.loading')}</Text> : null}
        {loadFailed ? <Notice kind="error" text={t('storefront.studio.chat.loadFailed')} /> : null}
        {!loading && !loadFailed && chronological.length === 0 ? <Text style={[styles.hint, { color: colors.muted }]}>{t('storefront.studio.chat.empty')}</Text> : null}
        {chronological.map((message) => {
          if (message.role === 'note') {
            const note = noteText(message.text, templateName)
            return note ? (
              <Text key={message.id} style={[styles.note, { color: colors.muted }]}>
                {note}
              </Text>
            ) : null
          }
          if (message.role === 'error') return <Notice key={message.id} kind="error" text={t('storefront.studio.chat.error')} />
          const mine = message.role === 'user'
          return (
            <View key={message.id} style={[styles.bubble, mine ? styles.mine : styles.theirs, { backgroundColor: mine ? colors.selected : colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
              <Text style={[styles.who, { color: colors.muted }]}>{mine ? t('storefront.studio.chat.you') : assistant}</Text>
              <Text style={[styles.text, { color: colors.text }]}>{message.text}</Text>
              {message.sampleUrl ? <Text style={[styles.meta, { color: colors.muted }]}>{t('storefront.studio.chat.inspiredBy', { site: message.sampleUrl })}</Text> : null}
              {message.changed.length > 0 ? <Text style={[styles.meta, { color: colors.success }]}>{message.changed.join(' · ')}</Text> : null}
              {message.undone ? <Text style={[styles.meta, { color: colors.muted }]}>{t('storefront.studio.chat.undone')}</Text> : null}
              {message.canUndo && !message.undone && !disabled ? <Button kind="secondary" label={t('storefront.studio.chat.undo')} busy={undoing === message.id} saves onPress={() => onUndo(message.id)} /> : null}
            </View>
          )
        })}
        {children}
      </ScrollView>
      <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={t('storefront.studio.chat.suggestionsLabel')} contentContainerStyle={styles.chips}>
          {suggestions.map((n) => (
            <Chip key={n} label={t(`storefront.studio.chat.suggestions.${n}`)} disabled={disabled} onPress={() => setText(t(`storefront.studio.chat.suggestions.${n}`))} />
          ))}
        </ScrollView>
        {failure ? <Notice kind="error" text={failure} /> : null}
        <TextInput
          accessibilityLabel={t('storefront.studio.chat.prompt')}
          value={text}
          onChangeText={setText}
          editable={!disabled}
          multiline
          maxLength={requestLimit}
          placeholder={t('storefront.studio.chat.placeholder')}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.text, borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}
        />
        {site !== null ? (
          <View style={styles.site}>
            <TextField
              label={t('storefront.studio.chat.siteField')}
              value={site}
              onChangeText={(value) => {
                setSite(value)
                setSiteProblem(false)
              }}
              keyboardType="url"
              placeholder={t('storefront.studio.chat.sitePlaceholder')}
              invalid={siteProblem}
              help={siteProblem ? t('storefront.studio.chat.siteInvalid') : t('storefront.studio.chat.siteHelp')}
            />
            <Button kind="secondary" label={t('storefront.studio.chat.removeSite')} onPress={() => setSite(null)} />
          </View>
        ) : (
          <Button kind="secondary" label={t('storefront.studio.chat.addSite')} disabled={disabled} onPress={() => setSite('')} />
        )}
        <Button label={asking ? t('storefront.studio.chat.sending') : t('storefront.studio.chat.send')} busy={asking} disabled={disabled || (text.trim() === '' && (site === null || site.trim() === ''))} saves onPress={() => void send()} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  messages: { flex: 1 },
  messagesContent: { padding: 14, gap: 10 },
  hint: { fontSize: 14, lineHeight: 21 },
  note: { fontSize: 13, textAlign: 'center' },
  bubble: { borderWidth: 1, padding: 12, gap: 6, maxWidth: '92%' },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  who: { fontSize: 12, fontWeight: '700' },
  text: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 13, lineHeight: 19 },
  composer: { borderTopWidth: 1, padding: 12, gap: 10 },
  chips: { gap: 8 },
  input: { borderWidth: 1.5, minHeight: 72, maxHeight: 140, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, textAlignVertical: 'top' },
  site: { gap: 8 },
})
