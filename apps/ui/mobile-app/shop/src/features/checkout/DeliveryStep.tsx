import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { setShippingOption, type Cart, type CartChange } from '../../api/cart'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { errorKey } from '../common/errors'
import { Button, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { Choice } from './Choice'
import { optionName, optionNote, optionPrice } from './words'

type Props = { cart: Cart; apply: (change: CartChange) => Promise<void>; next: () => void; changeAddress: () => void }

/**
 * The options the API gives for the address: own delivery inside an area, else the courier or flat rate, and pickup beside either.
 * The shopper never chooses between own delivery and the courier: the API offers only the one that applies (api/DELIVERY.md §2).
 */
export function DeliveryStep({ cart, apply, next, changeAddress }: Props) {
  const { client } = useShop()
  const { colors } = useTheme()
  const action = useAction()
  const chosen = cart.shippingOptions.find((o) => o.id === cart.shippingOption)?.id ?? null

  const choose = async (option: string) => {
    const done = await action.run(() => setShippingOption(client, option))
    if (done) await apply(done.value)
  }

  if (cart.shippingOptions.length === 0) {
    return (
      <View style={styles.step}>
        <StateMessage title={t('checkout.delivery.none.title')} body={t('checkout.delivery.none.body')} actionLabel={t('checkout.change')} onAction={changeAddress} />
      </View>
    )
  }

  return (
    <View style={styles.step}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('checkout.delivery.title')}
      </Text>
      <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('checkout.delivery.intro')}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('checkout.delivery.title')} style={styles.group}>
        {cart.shippingOptions.map((option) => (
          <Choice key={option.id} selected={chosen === option.id} disabled={action.busy} label={optionName(option)} note={optionNote(option)} price={optionPrice(option)} onPress={() => void choose(option.id)} />
        ))}
      </View>
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      <Button label={t('checkout.continue')} disabled={chosen === null || action.busy} onPress={next} />
    </View>
  )
}

const styles = StyleSheet.create({
  step: { gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  group: { gap: 10 },
})
