import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { StorefrontVersion } from '../../api/storefront'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Eyebrow } from '../common/Eyebrow'
import { versionLabel, versionMeta } from './siteView'

type Props = { versions: readonly StorefrontVersion[]; timeZone: string; canRestore: boolean; onRestore: (version: StorefrontVersion) => void }

// "Recent versions": each publish is kept, and an older one can be put live again for free (AI-STUDIO §5).
export function VersionsCard({ versions, timeZone, canRestore, onRestore }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.group}>
      <Eyebrow text={t('storefront.versions.eyebrow')} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        {versions.map((version, index) => (
          <View key={version.id} style={[styles.row, { borderColor: colors.border, borderTopWidth: index === 0 ? 0 : 1 }]}>
            <View style={styles.text}>
              <Text style={[styles.label, { color: colors.heading }]}>{versionLabel(version)}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{versionMeta(version, timeZone)}</Text>
            </View>
            {version.live ? (
              <View style={[styles.pill, { backgroundColor: colors.successSurface }]}>
                <Text style={[styles.pillText, { color: colors.success }]}>{t('storefront.versions.live')}</Text>
              </View>
            ) : canRestore ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('storefront.versions.restoreLabel', { number: version.number })} hitSlop={4} onPress={() => onRestore(version)} style={styles.restore}>
                <Text style={[styles.restoreText, { color: colors.link }]}>{t('storefront.versions.restore')}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  card: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  label: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12 },
  pill: { height: 22, paddingHorizontal: 9, borderRadius: 11, justifyContent: 'center' },
  pillText: { fontSize: 12, fontWeight: '600' },
  restore: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  restoreText: { fontSize: 13, fontWeight: '700' },
})
