import type { EditorProduct } from '../../../api/products'
import { t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import type { ProductAccess } from '../access'
import type { BannerSpec } from './EditorBanner'
import type { DraftProblem } from './draft'
import type { KindProblem, ProductKind } from './kindDetails'

export type SaveFailure = { code: string | null; message: string }

type Input = {
  access: ProductAccess
  isNew: boolean
  product: Pick<EditorProduct, 'supplier' | 'approval' | 'sentBackReason'> | null
  approvalRequired: boolean
  kind: ProductKind
  failure: SaveFailure | null
  problems: readonly (DraftProblem | KindProblem)[]
  onReload: () => void
}

/** What the editor says above the form, most pressing first: why a save didn't go, then what is true of this product for this seat (E1–E3, L2–L4). */
export const bannersOf = ({ access, isNew, product, approvalRequired, kind, failure, problems, onReload }: Input): BannerSpec[] => {
  const banners: BannerSpec[] = []
  if (failure) {
    const stale = failure.code === 'STALE_REVISION'
    banners.push(
      stale
        ? { key: 'stale', tone: 'danger', title: t('products.banner.stale'), body: t('products.banner.staleBody'), action: { label: t('products.banner.reload'), onPress: onReload } }
        : { key: 'failed', tone: 'danger', title: t('products.banner.failed'), body: failure.message },
    )
  }
  if (problems.length > 0) banners.push({ key: 'fix', tone: 'danger', title: tCount('products.banner.fix', problems.length), body: problems.map((problem) => t(problem === 'price' && kind === 'gift_card' ? 'products.problem.giftPrice' : `products.problem.${problem}`)).join(' · ') })
  if (access.readOnlyStore) banners.push({ key: 'readOnly', tone: 'info', title: t('products.banner.readOnly'), body: t('products.banner.readOnlyBody') })
  if (access.side === 'supplier' && product?.approval === 'sent_back' && product.sentBackReason) {
    banners.push({ key: 'sentBack', tone: 'danger', title: t('products.banner.sentBack'), body: t('products.banner.sentBackBody', { reason: product.sentBackReason }) })
  }
  if (access.side === 'merchant' && product?.supplier && !isNew) banners.push({ key: 'theirs', tone: 'info', title: t('products.banner.theirs', { supplier: product.supplier.name }), body: t('products.banner.theirsBody') })
  if (access.side === 'supplier' && access.canEdit && !isNew) banners.push({ key: 'ownerToo', tone: 'info', title: t('products.banner.ownerToo'), body: approvalRequired ? t('products.banner.ownerTooApproval') : t('products.banner.ownerTooLive') })
  if (access.side === 'supplier' && access.proposes && !isNew) banners.push({ key: 'stockOnly', tone: 'info', title: t('products.banner.stockOnly'), body: t('products.banner.stockOnlyBody') })
  if (access.side === 'supplier' && access.canEdit && (isNew ? approvalRequired || access.proposes : false)) banners.push({ key: 'approval', tone: 'warning', title: t('products.banner.approval'), body: t('products.banner.approvalBody') })
  if (access.viewOnly && !access.proposes) banners.push({ key: 'viewOnly', tone: 'info', title: t('products.banner.viewOnly'), body: t('products.banner.viewOnlyBody') })
  return banners
}
