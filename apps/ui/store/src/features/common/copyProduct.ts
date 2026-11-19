import { isApiError } from '@dripfunnel/shared/graphql'
import { duplicateProduct } from '../../api/products'
import { messages } from '../../messages'
import { flash } from '../offers/flash'

const words = messages.products

/** Copies a product for the page or row that asked: the copy's id with its message ready to show, or why not (#1446). */
export const copyProduct = async (id: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> => {
  try {
    const copy = await duplicateProduct(id)
    flash(words.duplicated)
    return { ok: true, id: copy }
  } catch (error) {
    return { ok: false, message: isApiError(error, 'PLAN_LIMIT') ? words.duplicateLimit : words.duplicateFailed }
  }
}
