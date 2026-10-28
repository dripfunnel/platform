import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { AccountRead, Pin } from '../../api/account'
import { setShippingAddress, type Cart, type CartChange } from '../../api/cart'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { AddressFields, checkAddress, draftOf, emptyDraft, type AddressProblems } from '../addresses/AddressFields'
import type { Draft } from '../addresses/rules'
import { errorKey } from '../common/errors'
import { Button } from '../common/ui'
import { useAction } from '../common/useAction'
import { Choice } from './Choice'

type Props = { cart: Cart; read: AccountRead; apply: (change: CartChange) => Promise<void>; next: () => void }

const lineOf = (a: Draft): string => [a.line1, a.city, a.postalCode].map((part) => part.trim()).filter(Boolean).join(', ')

/** A saved address or a new one, always with its map pin: own delivery decides by it (api/DELIVERY.md §2). The API quotes the delivery from what is sent. */
export function AddressStep({ cart, read, apply, next }: Props) {
  const { client } = useShop()
  const { colors } = useTheme()
  const action = useAction()
  const saved = read.account?.addresses ?? []
  const [mode, setMode] = useState<'pick' | 'form'>(saved.length > 0 ? 'pick' : 'form')
  const [selected, setSelected] = useState<string | null>(saved.find((a) => a.isDefault)?.id ?? saved[0]?.id ?? null)
  const current = cart.shippingAddress
  const [draft, setDraft] = useState<Draft>(current ? draftOf(current) : emptyDraft(read.countries.length === 1 ? (read.countries[0] ?? '') : ''))
  const [pin, setPin] = useState<Pin | null>(current?.pin ?? null)
  const [problems, setProblems] = useState<AddressProblems>({})

  const send = async (address: Draft, at: Pin) => {
    const done = await action.run(() => setShippingAddress(client, { ...address, pin: at }))
    if (!done) return
    await apply(done.value)
    next()
  }

  const continueWithSaved = async () => {
    const chosen = saved.find((a) => a.id === selected)
    if (!chosen) return
    if (chosen.pin) return send(draftOf(chosen), chosen.pin)
    // An address saved without a pin (on the website) is used once the pin is put on it.
    setDraft(draftOf(chosen))
    setPin(null)
    setProblems({ pin: 'required' })
    setMode('form')
  }

  const continueWithForm = async () => {
    const found = checkAddress(draft, pin)
    setProblems(found)
    if (Object.keys(found).length > 0 || !pin) return
    await send(draft, pin)
  }

  return (
    <View style={styles.step}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('checkout.address.title')}
      </Text>
      {mode === 'pick' ? (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('checkout.address.saved')} style={styles.group}>
            {saved.map((a) => (
              <Choice key={a.id} selected={selected === a.id} label={a.name} note={`${lineOf(a)} · ${a.pin ? t('checkout.address.pinSet') : t('checkout.address.noPin')}`} onPress={() => setSelected(a.id)} />
            ))}
          </View>
          <Button kind="secondary" label={t('checkout.address.add')} onPress={() => { setDraft(emptyDraft(read.countries.length === 1 ? (read.countries[0] ?? '') : '')); setPin(null); setProblems({}); setMode('form') }} />
        </>
      ) : (
        <>
          <AddressFields countries={read.countries} draft={draft} onDraft={setDraft} pin={pin} onPin={setPin} problems={problems} />
          {saved.length > 0 ? <Button kind="secondary" label={t('checkout.address.useSaved')} onPress={() => setMode('pick')} /> : null}
        </>
      )}
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      <Button saves label={t('checkout.continue')} busy={action.busy} onPress={() => void (mode === 'pick' ? continueWithSaved() : continueWithForm())} />
    </View>
  )
}

const styles = StyleSheet.create({
  step: { gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  group: { gap: 10 },
})
