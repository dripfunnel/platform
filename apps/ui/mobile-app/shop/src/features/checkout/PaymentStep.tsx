import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { continueToPayment, paymentOptionsOperation, type Cart, type CartChange, type PaymentOption } from '../../api/cart'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { money } from '../catalogue/words'
import { errorKey } from '../common/errors'
import { Button, Resource } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'
import { Choice } from './Choice'
import { sendBack } from './steps'
import { paymentName, takesPayment } from './words'

type Props = {
  cart: Cart
  provider: string | null
  onProvider: (provider: string) => void
  apply: (change: CartChange) => Promise<void>
  next: () => void
  onRefused: (error: unknown) => void
}

function Options({ cart, options, provider, onProvider, apply, next, onRefused }: Props & { options: PaymentOption[] }) {
  const { client } = useShop()
  const { colors } = useTheme()
  const action = useAction(sendBack(onRefused))
  const usable = options.filter(takesPayment)

  // A store with one way to pay has it chosen already, as the website does.
  useEffect(() => {
    const only = usable.length === 1 ? usable[0] : undefined
    if (provider === null && only) onProvider(only.provider)
  }, [provider, usable, onProvider])

  const proceed = async () => {
    const done = await action.run(() => continueToPayment(client))
    if (done) {
      await apply({ cart: done.value, cartToken: null })
      next()
    }
  }

  return (
    <>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('checkout.payment.title')} style={styles.group}>
        {options.map((option) => {
          const usableNow = takesPayment(option)
          const note = usableNow ? null : t('checkout.payment.soon')
          return (
            <Choice key={option.provider} selected={provider === option.provider} disabled={!usableNow} label={paymentName(option.provider)} note={note} onPress={() => onProvider(option.provider)}>
              {usableNow && provider === option.provider ? (
                <View style={styles.detail}>
                  {option.provider === 'cod' && cart.total ? <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('checkout.payment.codNote', { total: money(cart.total) })}</Text> : null}
                  {option.provider === 'bank_transfer' ? (
                    <>
                      {option.instructions ? <Text style={{ color: colors.text, fontSize: 14 }}>{option.instructions}</Text> : null}
                      <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('checkout.payment.bankNote')}</Text>
                    </>
                  ) : null}
                </View>
              ) : null}
            </Choice>
          )
        })}
      </View>
      {usable.length === 0 ? (
        <View accessibilityRole="alert" style={styles.detail}>
          <Text style={{ color: colors.heading, fontSize: 15, fontWeight: '700' }}>{t('checkout.payment.none.title')}</Text>
          <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('checkout.payment.none.body')}</Text>
        </View>
      ) : null}
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      <Button label={t('checkout.continue')} disabled={provider === null || !usable.some((o) => o.provider === provider)} busy={action.busy} onPress={() => void proceed()} />
    </>
  )
}

/** The store's ways to pay in the API's order. This card takes cash on delivery and bank transfer; the others are listed and cannot be chosen yet (SH 11, SH 12). */
export function PaymentStep(props: Props) {
  const { colors } = useTheme()
  const { state, retry } = useOperation(paymentOptionsOperation())
  return (
    <View style={styles.step}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('checkout.payment.title')}
      </Text>
      <Resource state={state} onRetry={retry} skeleton="list">
        {(options) => <Options {...props} options={options} />}
      </Resource>
    </View>
  )
}

const styles = StyleSheet.create({
  step: { gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  group: { gap: 10 },
  detail: { gap: 6, paddingHorizontal: 14, paddingBottom: 14 },
})
