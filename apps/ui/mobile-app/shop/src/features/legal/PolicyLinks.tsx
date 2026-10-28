import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import { useOnline } from '../states/connection'
import { policies, type PolicyKind } from './policies'
import { useOpenPolicy } from './useOpenPolicy'

/** Links to the pages a sentence names, each a 44 px target opening the storefront's page in the in-app browser. */
export function PolicyLinks({ kinds }: { kinds: readonly PolicyKind[] }) {
  const { colors } = useTheme()
  const online = useOnline()
  const { open, failed } = useOpenPolicy()
  return (
    <View style={styles.links}>
      {policies
        .filter(({ kind }) => kinds.includes(kind))
        .map(({ kind, title }) => (
          <Pressable
            key={kind}
            accessibilityRole="link"
            accessibilityLabel={t(title)}
            accessibilityHint={online ? undefined : t('states.offline.writes')}
            accessibilityState={{ disabled: !online }}
            disabled={!online}
            onPress={() => void open(kind)}
            style={[styles.link, { opacity: online ? 1 : 0.5 }]}
          >
            <Text style={{ color: colors.link, fontSize: 14, fontWeight: '700' }}>{t(title)}</Text>
          </Pressable>
        ))}
      {failed ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
          {t('legal.failed')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 18 },
  link: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
})
