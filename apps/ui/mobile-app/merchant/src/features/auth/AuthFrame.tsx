import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, Text } from 'react-native'
import { BrandMark } from '../../brand/BrandMark'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { LinkButton } from '../common/LinkButton'
import { Screen } from '../common/Screen'

// The frame every getting-in step shares: the partner's mark, a back link, the title and its explanation.
export function AuthFrame({ title, sub, back, onBack, children }: { title: string; sub: string; back?: boolean; onBack?: () => void; children: ReactNode }) {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <Screen>
      <BrandMark />
      {back ? <LinkButton label={`← ${t('common.back')}`} onPress={onBack ?? (() => router.back())} /> : null}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {title}
      </Text>
      <Text style={[styles.sub, { color: colors.muted }]}>{sub}</Text>
      {children}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', lineHeight: 34 },
  sub: { fontSize: 15, lineHeight: 23 },
})
