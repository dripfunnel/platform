import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { copyText } from '../../common/copyText'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'

export type Secret = { title: string; warning: string; value: string }

// A secret is shown once, here, until "I've stored it" (ACCESS.md §5.6): it lives only in this card's props, is never written to a log or to
// storage, and is gone when the screen is left. The text is selectable as well as copyable.
export function SecretCard({ secret, onStored }: { secret: Secret; onStored: () => void }) {
  const { colors, radii } = useTheme()
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  return (
    <SectionCard title={secret.title}>
      <Notice text={secret.warning} />
      <View style={[styles.value, { backgroundColor: colors.page, borderColor: colors.border, borderRadius: radii.button }]}>
        <Text selectable style={[styles.code, { color: colors.text }]}>
          {secret.value}
        </Text>
      </View>
      {copy === 'failed' ? <Notice kind="error" text={t('settings.developers.copyFailed')} /> : null}
      <Button
        kind="secondary"
        label={copy === 'copied' ? t('settings.developers.copied') : t('settings.developers.copy')}
        onPress={() => void copyText(secret.value).then((done) => setCopy(done ? 'copied' : 'failed'))}
      />
      <Button label={t('settings.developers.stored')} onPress={onStored} />
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  value: { borderWidth: 1, padding: 12 },
  code: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
})
