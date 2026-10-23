import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { CartDetail } from '../../api/carts'
import { formatList, formatNumber } from '@dripfunnel/mobile-shared/format'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { saysShipping } from '../common/region'
import type { CartsAccess } from './access'
import { CartEvents } from './CartEvents'
import { CartLines } from './CartLines'
import { CartNotes } from './CartNotes'
import { CartPill } from './CartPill'
import { CartSheets, type CartSheet } from './CartSheets'
import { agoText, canRemind, pillOf, senderOf, statusLine, stepText } from './cartText'
import { customerHref, orderHref } from './routes'
import type { CartFacts } from './useCartFacts'

type Props = { client: ApiClient; detail: CartDetail; access: CartsAccess; facts: CartFacts; refresh: () => Promise<void> }

// One abandoned cart (Carts › cart view): what's in it as it would be bought now, what happened, the shopper, links to the order and the customer, and
// the reminder actions this seat has. Statuses, stock and values are the API's.
export function CartView({ client, detail, access, facts, refresh }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const [sheet, setSheet] = useState<CartSheet | null>(null)
  const { cart, lines } = detail
  const sender = senderOf(access.readOnly, facts.sending)
  const now = new Date()
  const gone = lines.filter((line) => line.outOfStock)
  const remind = access.canEdit && canRemind(cart)
  const pill = pillOf(cart, sender)

  return (
    <View style={styles.content}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.name, { color: colors.heading }]}>
          {cart.name ?? t('carts.guest')}
        </Text>
        <CartPill {...pill} />
        <Text style={[styles.sub, { color: colors.muted }]}>{t('carts.page.left', { line: statusLine(cart, now, sender), step: stepText(cart.step, facts.country), ago: agoText(cart.abandonedAt, now) })}</Text>
      </View>
      <CartNotes access={access} sending={facts.sending} />
      {gone.length > 0 && cart.status !== 'recovered' ? (
        <Notice text={gone.length === lines.length ? t('carts.page.allGone') : tCount('carts.page.someGone', gone.length, { names: formatList(gone.map((line) => line.name ?? t('carts.item')), locale) })} />
      ) : null}
      <View style={styles.actions}>
        {remind ? <Button saves label={t('carts.menu.send')} onPress={() => setSheet({ act: 'send', cart })} /> : null}
        {cart.recoveredOrderId && access.canOpenOrder ? <Button label={t('carts.menu.order', { number: cart.recoveredOrderNumber ?? '' })} onPress={() => router.push(orderHref(cart.recoveredOrderId ?? '') as never)} /> : null}
        {remind ? <Button saves kind="secondary" label={t('carts.menu.stop')} onPress={() => setSheet({ act: 'stop', cart })} /> : null}
        {access.canEdit && cart.status === 'stopped' ? <Button saves kind="secondary" label={t('carts.menu.resume')} onPress={() => setSheet({ act: 'resume', cart })} /> : null}
        {cart.customerId && access.canOpenCustomer ? <Button kind="secondary" label={t('carts.menu.customer')} onPress={() => router.push(customerHref(cart.customerId ?? '') as never)} /> : null}
      </View>
      <CartLines detail={detail} shipWord={t(saysShipping(facts.country) ? 'carts.page.shipping' : 'carts.page.delivery')} />
      <CartEvents detail={detail} country={facts.country} now={now} />
      <SectionCard title={t('carts.page.shopper')}>
        <Fact label={t('carts.page.email')} value={cart.email ?? t('carts.page.notGiven')} />
        <Fact label={t('carts.page.phone')} value={cart.phone ?? '—'} />
        <Fact label={t('carts.page.sent')} value={formatNumber(cart.remindersSent, locale)} />
      </SectionCard>
      <CartSheets sheet={sheet} client={client} codes={facts.sending?.level === 'automatic'} scheduled={sender === 'schedule'} onClose={() => setSheet(null)} onDone={() => void refresh()} />
    </View>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.fact}>
      <Text style={[styles.sub, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 6 },
  name: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  actions: { gap: 8 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  value: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
})
