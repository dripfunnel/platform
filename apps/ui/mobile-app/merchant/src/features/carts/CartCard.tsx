import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { AbandonedCart } from '../../api/carts'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { agoText, canRemind, itemsText, moneyText, pillOf, statusLine, stepText, type Sender } from './cartText'
import { CartPill } from './CartPill'

export type CartAction = 'send' | 'stop' | 'resume'

type Props = { cart: AbandonedCart; sender: Sender; country: string | null; now: Date; canEdit: boolean; onOpen: () => void; onAct: (act: CartAction) => void }

// A cart as a stacked card (DESIGN.md §4; the prototype's phone card): its reminder status and value, the shopper, the items, where they left
// and how long ago with the status's own line, and the actions this seat has. Every status and figure is the API's.
export function CartCard({ cart, sender, country, now, canEdit, onOpen, onAct }: Props) {
  const { colors, radii } = useTheme()
  const pill = pillOf(cart, sender)
  const name = cart.name ?? t('carts.guest')
  const remind = canEdit && canRemind(cart)
  const resume = canEdit && cart.status === 'stopped'
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('carts.row.open', { name })} onPress={onOpen} style={styles.open}>
        <View style={styles.top}>
          <CartPill {...pill} />
          <Text style={[styles.value, { color: colors.text }]}>{cart.value ? moneyText(cart.value) : '—'}</Text>
        </View>
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{cart.email ?? t('carts.noEmail')}</Text>
        <Text style={[styles.sub, { color: colors.textStrong }]}>{itemsText(cart)}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{[stepText(cart.step, country), agoText(cart.abandonedAt, now), statusLine(cart, now, sender)].join(' · ')}</Text>
      </Pressable>
      {remind || resume ? (
        <View style={styles.actions}>
          {remind ? (
            <>
              <View style={styles.action}>
                <Button saves kind="secondary" label={t('carts.menu.send')} onPress={() => onAct('send')} />
              </View>
              <View style={styles.action}>
                <Button saves kind="secondary" label={t('carts.menu.stop')} onPress={() => onAct('stop')} />
              </View>
            </>
          ) : (
            <View style={styles.action}>
              <Button saves kind="secondary" label={t('carts.menu.resume')} onPress={() => onAct('resume')} />
            </View>
          )}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 14, gap: 10 },
  open: { gap: 4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '800' },
  value: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
})
