import { StyleSheet, Text } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { SheetFrame } from '../shell/BottomSheet'

type Props = { onClose: () => void; onOpenWeb: () => void; onOpenHere: () => void }

// "Best on the web" (DESIGN.md §3, §5): templates and the full designer open the web portal in the phone's browser, never an emailed link.
export function BestOnWebSheet({ onClose, onOpenWeb, onOpenHere }: Props) {
  const { colors } = useTheme()
  return (
    <SheetFrame onClose={onClose}>
      <Text style={[styles.tag, { color: colors.muted }]}>{t('storefront.web.tag')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('storefront.web.label')}
      </Text>
      <Text style={[styles.body, { color: colors.textStrong }]}>{t('storefront.web.body')}</Text>
      <Button
        label={t('storefront.web.open')}
        onPress={() => {
          onClose()
          onOpenWeb()
        }}
      />
      <Button
        kind="secondary"
        label={t('storefront.web.here')}
        onPress={() => {
          onClose()
          onOpenHere()
        }}
      />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  tag: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700' },
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
})
