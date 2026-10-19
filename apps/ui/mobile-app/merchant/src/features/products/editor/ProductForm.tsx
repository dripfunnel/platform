import { useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { ShellScreen } from '../../states/ShellScreen'
import { useFeedback } from '../../shell/Feedback'
import { useShell } from '../../shell/ShellData'
import { storyHref } from '../routes'
import { useReview } from '../useReview'
import { AdjustSheet } from './AdjustSheet'
import { AplusCard } from './AplusCard'
import { ChoicesCard } from './ChoicesCard'
import { DetailsCard } from './DetailsCard'
import { DownloadCard } from './DownloadCard'
import { EditorBanner } from './EditorBanner'
import { GiftCardCard } from './GiftCardCard'
import { KindCard } from './KindCard'
import { PhotosCard } from './PhotosCard'
import { PriceCard } from './PriceCard'
import { ReadinessCard } from './ReadinessCard'
import { ReviewCard } from './ReviewCard'
import { ServiceCard } from './ServiceCard'
import { SaveBar } from '../../common/SaveBar'
import { SizeChartCard } from './SizeChartCard'
import { StockCard } from './StockCard'
import { VersionsCard } from './VersionsCard'
import { bannersOf } from './editorBanners'
import { versionsMade, type DraftVersion } from './draft'
import type { EditorData } from './loadEditor'
import { useDownloadFile } from './useDownloadFile'
import { usePhotos } from './usePhotos'
import { useProductForm } from './useProductForm'
import type { StockContext } from './stock'

type Props = { client: ApiClient; data: EditorData; onReload: () => void }

// The product editor (FIRST-RELEASE.md §11, CatEditor at phone width): photos, details, price or choices and versions, stock with
// its history, A+ content and readiness, with a save bar once there is something to save. What this seat may change is the API's list of
// permissions; whatever the phone doesn't edit is sent back as it was (draft.ts).
export function ProductForm({ client, data, onReload }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const navigation = useNavigation()
  const feedback = useFeedback()
  const { seat } = useShell()
  const form = useProductForm(client, data, onReload)
  const { draft, update, current } = form
  const photos = usePhotos(draft, update)
  const pickDownload = useDownloadFile(update)
  const [adjusting, setAdjusting] = useState<DraftVersion | null>(null)
  const review = useReview(client, () => {
    onReload()
  })

  usePreventRemove(form.dirty && !form.leaving, ({ data: { action } }) =>
    feedback.menu({
      title: t('products.leave.title'),
      sub: t('products.leave.body'),
      items: [
        { key: 'keep', label: t('products.leave.keep'), onPress: () => undefined },
        { key: 'discard', label: t('products.leave.discard'), danger: true, onPress: () => form.leave(() => navigation.dispatch(action)) },
      ],
    }),
  )

  const kind = draft.kind
  const physical = kind === 'physical'
  const giftCard = kind === 'gift_card'
  const made = versionsMade(draft)
  const stock: StockContext | null = physical && (form.canEdit || form.canStock) ? { warehouses: data.warehouses, levels: form.levels, canStock: form.canStock && !form.saving } : null
  const disabled = !form.canEdit || form.saving
  const banners = bannersOf({ access: form.access, isNew: form.isNew, product: current, approvalRequired: data.approvalRequired, kind, failure: form.failure, problems: [...form.shown, ...form.kindShown], onReload })
  const waits = form.access.side === 'supplier' && (form.access.proposes || data.approvalRequired)
  const canSave = form.canEdit || form.canStock
  const saveLabel = form.saving ? t('products.saving') : !form.canEdit ? t('products.stock.saveStock') : waits ? t('products.submit') : form.isNew ? t('products.saveNew') : t('products.save')
  const heading = form.isNew ? t('products.newProduct') : draft.name || t('products.untitled')
  const pending = current !== null && current.approval === 'pending' && form.access.canApprove
  const reviewed = current ? { id: current.id, name: current.name, supplier: current.supplier?.name ?? null } : null

  return (
    <View style={styles.root}>
      <ShellScreen label={t('products.title')}>
        <View style={styles.content}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.heading }]}>
            {heading}
          </Text>
          {banners.map((spec) => (
            <EditorBanner key={spec.key} spec={spec} />
          ))}
          {pending && reviewed ? <ReviewCard supplier={reviewed.supplier} onApprove={() => void review.approve(reviewed)} onSendBack={() => review.sendBack(reviewed)} /> : null}
          {form.access.side === 'merchant' ? <KindCard kind={kind} disabled={disabled} onPick={form.pickKind} /> : null}
          {kind === 'digital' ? <DownloadCard draft={draft} update={update} disabled={disabled} problems={form.kindShown} onPick={() => void pickDownload()} /> : null}
          {kind === 'service' ? <ServiceCard draft={draft} update={update} disabled={disabled} /> : null}
          {giftCard ? <GiftCardCard draft={draft} update={update} disabled={disabled} currency={data.currency} problems={form.shown} /> : null}
          <PhotosCard draft={draft} update={update} photos={photos} disabled={disabled} />
          <DetailsCard draft={draft} update={update} disabled={disabled} nameMissing={form.shown.includes('name')} showVisibility={form.access.storeFields} />
          {!made && !giftCard ? <PriceCard draft={draft} update={update} currency={data.currency} disabled={disabled} problems={form.shown} /> : null}
          {stock && !made ? <StockCard draft={draft} update={update} stock={stock} client={client} productId={current?.id ?? null} simple onAdjust={setAdjusting} /> : null}
          {!giftCard ? <ChoicesCard draft={draft} update={update} disabled={disabled} invalid={form.shown.includes('options') || form.shown.includes('versions')} /> : null}
          {made && !giftCard ? (
            <VersionsCard draft={draft} update={update} currency={data.currency} disabled={disabled} canHideProduct={form.access.storeFields} problems={form.shown} stock={stock} onAdjust={setAdjusting} />
          ) : null}
          {stock && made ? <StockCard draft={draft} update={update} stock={stock} client={client} productId={current?.id ?? null} simple={false} onAdjust={setAdjusting} /> : null}
          {data.sizeCharts !== null && physical ? <SizeChartCard draft={draft} update={update} charts={data.sizeCharts} disabled={disabled} /> : null}
          {data.aplus ? (
            <AplusCard availability={data.aplus} productId={current?.id ?? null} dirty={form.dirty} onOpen={() => current && router.push(storyHref(seat, current.id) as never)} />
          ) : null}
          {current ? <ReadinessCard readiness={current.readiness} saved /> : form.access.side === 'merchant' ? <ReadinessCard readiness={[]} saved={false} /> : null}
        </View>
      </ShellScreen>
      {canSave && (form.dirty || form.failure) ? <SaveBar failed={form.failure !== null} label={saveLabel} busy={form.saving} onDiscard={form.discard} onSave={form.save} /> : null}
      {adjusting ? (
        <AdjustSheet
          name={adjusting.choices.length > 0 ? adjusting.choices.join(' / ') : t('products.stock.thisProduct')}
          warehouses={data.warehouses}
          onApply={(change) => form.adjust(adjusting, change)}
          onClose={() => setAdjusting(null)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  heading: { fontSize: 20, fontWeight: '800' },
})
