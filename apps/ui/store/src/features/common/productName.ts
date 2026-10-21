import { currentBrand } from '../../brand/current'
import { messages } from '../../messages'

/** The product the person signs in to: the partner's name for it, else DripFunnel's. */
export const productName = (): string => currentBrand()?.productName ?? messages.auth.productName
