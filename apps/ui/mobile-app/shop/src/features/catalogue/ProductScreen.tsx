import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { addToCart, productOperation, type Product } from '../../api/catalogue'
import { useShop } from '../../api/ShopContext'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { Gallery } from './Gallery'
import { OptionPicker } from './OptionPicker'
import { ProductPrice } from './ProductPrice'
import { ProductSections } from './ProductSections'
import { choose, initialSelection, missingOptions, versionFor, type Selection } from './options'
import { Button, OfflineBanner, ScreenHeader, StateMessage, Skeleton } from '../common/ui'
import { useOperation } from '../common/useOperation'
import { stockLine } from './words'
import { errorKey } from '../common/errors'

export const maxQuantity = 99

function Stepper({ quantity, onChange }: { quantity: number; onChange: (next: number) => void }) {
  const { colors, radii } = useTheme()
  const step = (label: string, next: number, disabled: boolean, glyph: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onChange(next)} style={[styles.step, { borderColor: colors.fieldBorder, borderRadius: radii.button }]}>
      <Text style={{ color: disabled ? colors.muted : colors.text, fontSize: 22 }}>{glyph}</Text>
    </Pressable>
  )
  return (
    <View style={styles.stepper}>
      {step(t('product.quantityLess'), quantity - 1, quantity <= 1, '−')}
      <Text accessibilityLabel={t('product.quantityValue', { count: quantity })} style={{ color: colors.text, fontSize: 17, fontWeight: '700', minWidth: 32, textAlign: 'center' }}>
        {quantity}
      </Text>
      {step(t('product.quantityMore'), quantity + 1, quantity >= maxQuantity, '+')}
    </View>
  )
}

function Loaded({ product, stale }: { product: Product; stale: boolean }) {
  const router = useRouter()
  const { client, saveCartToken } = useShop()
  const { colors } = useTheme()
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product))
  const [quantity, setQuantity] = useState(1)
  const [adding, setAdding] = useState(false)
  const [outcome, setOutcome] = useState<{ kind: 'added' } | { kind: 'refused'; code: string } | null>(null)

  const version = versionFor(product, selection)
  const missing = missingOptions(product, selection)
  const stock = stockLine(product, version, missing)
  const photos = product.photos.filter((photo) => photo.versionId === null || photo.versionId === version?.id).sort((a, b) => Number(b.versionId === version?.id) - Number(a.versionId === version?.id))
  const priced = version ? version.price !== null : product.price !== null

  // What stops the add, in the words on the button; the API still decides on the add itself.
  const blocked = (() => {
    if (!product.inStock || (version && !version.inStock)) return t('product.stock.soldOut')
    if (missing[0]) return t('product.chooseOption', { option: missing[0].name.toLowerCase() })
    if (!version || !priced) return t('product.unavailable')
    if (stale) return t('product.offlineAdd')
    return null
  })()

  const add = async () => {
    if (!version || blocked) return
    setAdding(true)
    setOutcome(null)
    try {
      const cartToken = await addToCart(client, version.id, quantity)
      if (cartToken) await saveCartToken(cartToken)
      setOutcome({ kind: 'added' })
    } catch (error) {
      setOutcome({ kind: 'refused', code: isApiError(error) ? error.code : 'UNKNOWN' })
    } finally {
      setAdding(false)
    }
  }

  const price = version ? { price: version.price, compareAt: version.compareAt, from: false } : { price: product.price, compareAt: product.compareAt, from: product.fromPrice }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {stale ? <OfflineBanner /> : null}
      <Gallery key={version?.id ?? 'none'} photos={photos} video={product.video} name={product.name} />
      <View style={styles.body}>
        <View style={styles.titleBlock}>
          {product.badge ? <Text style={{ color: colors.link, fontWeight: '700', fontSize: 13 }}>{product.badge}</Text> : null}
          <Text accessibilityRole="header" style={[styles.name, { color: colors.heading }]}>
            {product.name}
          </Text>
          <ProductPrice {...price} pricesIncludeTax={product.pricesIncludeTax} />
        </View>
        <OptionPicker product={product} selection={selection} onChoose={(optionId, valueId) => setSelection((now) => choose(now, optionId, valueId))} />
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, fontWeight: '700', color: stock.tone === 'good' ? colors.success : stock.tone === 'low' ? colors.warning : stock.tone === 'out' ? colors.danger : colors.muted }}>
          {stock.text}
        </Text>
        <View style={styles.buy}>
          <Stepper quantity={quantity} onChange={setQuantity} />
          <View style={styles.buyButton}>
            <Button label={blocked ?? t('product.addToCart')} disabled={blocked !== null} busy={adding} onPress={() => void add()} />
          </View>
        </View>
        {outcome?.kind === 'refused' ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {t(errorKey(outcome.code))}
          </Text>
        ) : null}
        {outcome?.kind === 'added' ? (
          <View accessibilityRole="alert" style={[styles.added, { backgroundColor: colors.successSurface, borderColor: colors.successBorder }]}>
            <Text style={{ color: colors.success, fontWeight: '700', fontSize: 15 }}>{t('product.added')}</Text>
            <Button kind="secondary" label={t('product.viewCart')} onPress={() => router.navigate('/cart')} />
          </View>
        ) : null}
        <ProductSections product={product} versionId={version?.id ?? null} />
      </View>
    </ScrollView>
  )
}

export function ProductScreen({ slug }: { slug: string }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { state, retry } = useOperation(productOperation(slug))
  const product = state.status === 'ready' ? state.data : null

  const content = () => {
    if (state.status === 'loading') return <Skeleton kind="detail" />
    if (state.status === 'error') return <StateMessage title={t('states.error.title')} body={t(errorKey(state.code))} actionLabel={t('states.retry')} onAction={retry} />
    if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} actionLabel={t('states.retry')} onAction={retry} />
    if (!state.data) return <StateMessage title={t('product.notFound.title')} body={t('product.notFound.body')} />
    // Keyed by product, so another product (a related one) never inherits this one's choices.
    return <Loaded key={state.data.id} product={state.data} stale={state.stale} />
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={product?.name ?? ''} onBack={() => (router.canGoBack() ? router.back() : router.replace('/browse'))} />
      {content()}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingBottom: 32 },
  body: { gap: 16, padding: 16 },
  titleBlock: { gap: 6 },
  name: { fontSize: 24, fontWeight: '700', lineHeight: 29 },
  buy: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  buyButton: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: 44, height: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  added: { gap: 10, padding: 12, borderWidth: 1, borderRadius: 12 },
})
