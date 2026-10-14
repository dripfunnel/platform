import { approveProduct, sendBackProduct } from '../../api/products'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { useFeedback } from '../shell/Feedback'

export type Reviewed = { id: string; name: string; supplier: string | null }

/** Approve, or send back with a reason the supplier sees (CATALOG-DESIGN.md L3; ACCESS.md §7.2); `done` runs after either. */
export function useReview(client: ApiClient, done: () => void) {
  const feedback = useFeedback()
  const supplierOf = (product: Reviewed) => product.supplier ?? t('products.review.theSupplier')

  const approve = async (product: Reviewed) => {
    try {
      await approveProduct(client, product.id)
      feedback.toast({ message: t('products.review.approved', { name: product.name, supplier: supplierOf(product) }) })
      done()
    } catch (error) {
      feedback.toast({ message: errorMessage(error, 'products') })
    }
  }

  const sendBack = (product: Reviewed) =>
    feedback.sheet({
      title: t('products.review.sendBackTitle', { supplier: supplierOf(product) }),
      body: t('products.review.sendBackBody'),
      input: { label: t('products.review.reasonLabel'), placeholder: t('products.review.reasonPlaceholder'), error: t('products.review.reasonMissing') },
      confirm: t('products.review.sendBack'),
      onConfirm: async ({ text }) => {
        try {
          await sendBackProduct(client, product.id, text)
          feedback.toast({ message: t('products.review.sentBack', { supplier: supplierOf(product) }) })
          done()
        } catch (error) {
          feedback.toast({ message: errorMessage(error, 'products') })
        }
      },
    })

  return { approve, sendBack }
}
