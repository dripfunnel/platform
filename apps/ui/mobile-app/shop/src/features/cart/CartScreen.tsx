import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { applyCode, removeCode, setQuantity, type Cart, type CartLine, type CodeState } from '../../api/cart'
import { useShop } from '../../api/ShopContext'
import { locale, t } from '../../messages'
import { money } from '../catalogue/words'
import { errorKey } from '../common/errors'
import { Field } from '../common/fields'
import { Button, Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useRefreshOnFocus } from '../common/useRefreshOnFocus'
import { Totals } from './Totals'
import { useCart } from './useCart'

/** The sentence under a line the engine cannot sell as it is; the engine says which problem, the app words it. */
const problemText = (line: CartLine): string | null => {
  if (line.problem === 'short') return line.available ? t('cart.problem.short', { count: formatNumber(line.available, locale) }) : t('cart.problem.soldOut')
  return line.problem ? t(`cart.problem.${line.problem}`) : null
}

export const hasLineProblem = (cart: Cart): boolean => cart.lines.some((line) => line.problem !== null)

type Change = (work: () => Promise<{ cart: Cart | null; cartToken: string | null }>) => Promise<void>

function LineRow({ line, busy, change, onOpen }: { line: CartLine; busy: boolean; change: Change; onOpen: (slug: string) => void }) {
  const { client } = useShop()
  const { colors, radii } = useTheme()
  const problem = problemText(line)
  const name = [line.name, line.versionName].filter(Boolean).join(', ')
  const step = (quantity: number) => void change(() => setQuantity(client, line.versionId, quantity))
  return (
    <View style={[styles.line, { borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={!line.productSlug} onPress={() => line.productSlug && onOpen(line.productSlug)} style={[styles.photo, { backgroundColor: colors.skeleton, borderRadius: radii.tile }]}>
        {line.photoUrl ? <Image source={{ uri: line.photoUrl }} accessibilityIgnoresInvertColors contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
      </Pressable>
      <View style={styles.lineBody}>
        <Text numberOfLines={2} style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
          {line.name}
        </Text>
        {line.versionName ? <Text style={{ color: colors.muted, fontSize: 13 }}>{line.versionName}</Text> : null}
        {line.unitPrice ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('cart.each', { price: money(line.unitPrice) })}</Text> : null}
        {problem ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
            {problem}
          </Text>
        ) : null}
        <View style={styles.stepper}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('cart.fewer', { name: line.name })} accessibilityState={{ disabled: busy || line.quantity <= 1 }} disabled={busy || line.quantity <= 1} onPress={() => step(line.quantity - 1)} style={[styles.stepButton, { borderColor: colors.fieldBorder, borderRadius: radii.button }]}>
            <Text style={{ color: colors.text, fontSize: 20 }}>−</Text>
          </Pressable>
          <Text accessibilityLabel={t('cart.quantity', { count: formatNumber(line.quantity, locale) })} style={{ color: colors.text, fontSize: 16, minWidth: 24, textAlign: 'center' }}>
            {formatNumber(line.quantity, locale)}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('cart.more', { name: line.name })} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => step(line.quantity + 1)} style={[styles.stepButton, { borderColor: colors.fieldBorder, borderRadius: radii.button }]}>
            <Text style={{ color: colors.text, fontSize: 20 }}>+</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('cart.remove', { name: line.name })} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => step(0)} style={styles.removeButton}>
            <Text style={{ color: colors.link, fontWeight: '700' }}>{t('cart.removeShort')}</Text>
          </Pressable>
        </View>
      </View>
      {line.lineTotal ? <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{money(line.lineTotal)}</Text> : null}
    </View>
  )
}

function Codes({ cart, busy, change }: { cart: Cart; busy: boolean; change: Change }) {
  const { client } = useShop()
  const { colors, radii } = useTheme()
  const action = useAction()
  const [entry, setEntry] = useState('')
  const [result, setResult] = useState<{ code: string; state: CodeState } | null>(null)

  const apply = async () => {
    const code = entry.trim()
    if (!code) return
    const done = await action.run(() => applyCode(client, code))
    if (!done) return
    setResult({ code, state: done.value.state })
    if (done.value.state === 'APPLIED') setEntry('')
    await change(() => Promise.resolve({ cart: done.value.cart, cartToken: null }))
  }

  return (
    <View style={styles.codes}>
      <Field label={t('cart.code.label')} value={entry} onChangeText={setEntry} autoCapitalize="characters" returnKeyType="done" onSubmitEditing={() => void apply()} />
      <Button kind="secondary" label={t('cart.code.apply')} busy={action.busy} disabled={busy || !entry.trim()} onPress={() => void apply()} />
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      {result ? (
        <Text accessibilityRole="alert" style={{ color: result.state === 'APPLIED' ? colors.success : colors.danger, fontSize: 13, fontWeight: '600' }}>
          {t(`cart.code.${result.state}`, { code: result.code })}
        </Text>
      ) : null}
      {cart.codes.map(({ code, state }) => (
        <View key={code} style={[styles.codeChip, { borderColor: colors.border, borderRadius: radii.button }]}>
          <View style={styles.codeText}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{code}</Text>
            {state === 'APPLIED' ? null : <Text style={{ color: colors.warning, fontSize: 13 }}>{t(`cart.code.${state}`, { code })}</Text>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('cart.code.remove', { code })} disabled={busy} onPress={() => void change(() => removeCode(client, code))} style={styles.removeButton}>
            <Text style={{ color: colors.link, fontWeight: '700' }}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
  )
}

function Filled({ cart, apply }: { cart: Cart; apply: (change: { cart: Cart | null; cartToken: string | null }) => Promise<void> }) {
  const router = useRouter()
  const { colors } = useTheme()
  const action = useAction()
  const change: Change = async (work) => {
    const done = await action.run(work)
    if (done) await apply(done.value)
  }
  const blocked = hasLineProblem(cart)
  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        {cart.lines.map((line) => (
          <LineRow key={line.versionId} line={line} busy={action.busy} change={change} onOpen={(slug) => router.push(`/product/${slug}`)} />
        ))}
        {action.error ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {t(errorKey(action.error))}
          </Text>
        ) : null}
        <Codes cart={cart} busy={action.busy} change={change} />
        <Totals cart={cart} stage="cart" />
      </ScrollView>
      <View style={[styles.footer, { borderColor: colors.border, backgroundColor: colors.page }]}>
        <Button label={cart.total ? t('cart.checkout', { total: money(cart.total) }) : t('checkout.title')} disabled={blocked || action.busy} onPress={() => router.push('/checkout')} />
      </View>
    </>
  )
}

export function CartScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { state, retry, refresh, apply } = useCart()
  useRefreshOnFocus(refresh)
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('cart.title')} />
      <Resource state={state} onRetry={retry} skeleton="list">
        {(cart) =>
          cart && cart.lines.length > 0 ? (
            <Filled cart={cart} apply={apply} />
          ) : (
            <StateMessage title={t('cart.empty.title')} body={t('cart.empty.body')} actionLabel={t('cart.empty.browse')} onAction={() => router.push('/browse')} />
          )
        }
      </Resource>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 16, padding: 16, paddingBottom: 24 },
  line: { flexDirection: 'row', gap: 12, paddingBottom: 16, borderBottomWidth: 1, alignItems: 'flex-start' },
  photo: { width: 72, aspectRatio: 4 / 5, overflow: 'hidden' },
  lineBody: { flex: 1, gap: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  stepButton: { width: 44, height: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  removeButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  codes: { gap: 10 },
  codeChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, paddingLeft: 12 },
  codeText: { flex: 1, gap: 2 },
  footer: { padding: 16, borderTopWidth: 1 },
})
