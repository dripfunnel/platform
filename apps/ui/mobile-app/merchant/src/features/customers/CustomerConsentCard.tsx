import { StyleSheet, Text } from 'react-native'
import type { Customer } from '../../api/customers'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { LinkButton } from '../common/LinkButton'
import { SectionCard } from '../common/SectionCard'
import { consentOf } from './customerFacts'

type Props = { customer: Customer; timeZone: string; canEdit: boolean; onStop: () => void }

// Marketing consent: only the shopper opts in, so the team's one action is to record that they asked to stop, and only while they're opted in.
export function CustomerConsentCard({ customer, timeZone, canEdit, onStop }: Props) {
  const { colors } = useTheme()
  const consent = consentOf(customer, timeZone)
  return (
    <SectionCard title={t('customers.detail.consent.title')}>
      <Text style={[styles.text, { color: consent.optedIn ? colors.success : colors.textStrong }]}>{consent.text}</Text>
      <Text style={[styles.sub, { color: colors.muted }]}>{consent.sub}</Text>
      {consent.optedIn && canEdit ? <LinkButton label={t('customers.detail.consent.stop')} onPress={onStop} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 13, lineHeight: 19 },
})
