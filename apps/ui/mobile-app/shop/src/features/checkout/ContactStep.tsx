import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Account } from '../../api/account'
import { setContact, type Cart, type CartChange } from '../../api/cart'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { compact, emailPattern, isPhone, type Problem } from '../account/validation'
import { errorKey } from '../common/errors'
import { Field } from '../common/fields'
import { Button } from '../common/ui'
import { useAction } from '../common/useAction'

type Props = { cart: Cart; account: Account | null; apply: (change: CartChange) => Promise<void>; next: () => void }

const message = (problem: Problem | undefined, invalid: 'form.invalidEmail' | 'form.invalidPhone') => (problem === 'required' ? t('form.required') : problem === 'invalid' ? t(invalid) : null)

/** Email for the receipt and, optionally, a number for the person delivering: the cart's own, else the signed-in account's. */
export function ContactStep({ cart, account, apply, next }: Props) {
  const { client } = useShop()
  const { colors } = useTheme()
  const action = useAction()
  const [email, setEmail] = useState(cart.email || account?.email || '')
  const [phone, setPhone] = useState(cart.phone || account?.phone || '')
  const [problems, setProblems] = useState<{ email?: Problem; phone?: Problem }>({})

  const save = async () => {
    const found: typeof problems = {}
    if (!email.trim()) found.email = 'required'
    else if (!emailPattern.test(email.trim())) found.email = 'invalid'
    if (phone.trim() && !isPhone(phone)) found.phone = 'invalid'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    const done = await action.run(() => setContact(client, { email: email.trim(), phone: compact(phone) || null }))
    if (!done) return
    await apply(done.value)
    next()
  }

  return (
    <View style={styles.step}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('checkout.contact.title')}
      </Text>
      <Field label={t('checkout.contact.email')} value={email} onChangeText={setEmail} error={message(problems.email, 'form.invalidEmail')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Text style={{ color: colors.muted, fontSize: 13 }}>{t('checkout.contact.emailHelp')}</Text>
      <Field label={t('checkout.contact.phone')} value={phone} onChangeText={setPhone} error={message(problems.phone, 'form.invalidPhone')} optional autoComplete="tel" keyboardType="phone-pad" textContentType="telephoneNumber" />
      <Text style={{ color: colors.muted, fontSize: 13 }}>{t('checkout.contact.phoneHelp')}</Text>
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      <Button label={t('checkout.continue')} busy={action.busy} onPress={() => void save()} />
    </View>
  )
}

const styles = StyleSheet.create({
  step: { gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
})
