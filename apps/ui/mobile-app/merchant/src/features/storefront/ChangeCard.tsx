import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Chip } from '../common/Chip'
import { Eyebrow } from '../common/Eyebrow'
import { TextArea } from '../common/TextArea'

const ideas = ['sale', 'colour', 'arrivals'] as const

type Props = { prompt: string; onPrompt: (text: string) => void; making: boolean; onMake: () => void }

// "Change something": a prompt that makes a draft. Nothing reaches the shop until it is published, and a change can take a minute, so the card says it is working.
export function ChangeCard({ prompt, onPrompt, making, onMake }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.group}>
      <Eyebrow text={t('storefront.change.eyebrow')} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        <TextArea label={t('storefront.change.label')} value={prompt} onChangeText={onPrompt} placeholder={t('storefront.change.placeholder')} editable={!making} lines={3} />
        <View style={styles.ideas}>
          {ideas.map((idea) => (
            <Chip key={idea} label={t(`storefront.change.ideas.${idea}`)} disabled={making} onPress={() => onPrompt(t(`storefront.change.ideas.${idea}`))} />
          ))}
        </View>
        {making ? (
          <View accessibilityLiveRegion="polite" style={styles.progress}>
            <ActivityIndicator color={colors.brand} />
            <Text style={[styles.step, { color: colors.textStrong }]}>{t('storefront.change.making')}</Text>
          </View>
        ) : null}
        <Button label={t('storefront.change.make')} disabled={making} saves onPress={onMake} />
        <Text style={[styles.note, { color: colors.muted }]}>{making ? t('storefront.change.makingBody') : t('storefront.change.note')}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  card: { borderWidth: 1, padding: 14, gap: 12 },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 12, lineHeight: 18 },
})
