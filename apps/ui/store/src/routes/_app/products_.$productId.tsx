import { createFileRoute } from '@tanstack/react-router'
import { ProductEditor } from '../../features/productEditor/ProductEditor'

export const Route = createFileRoute('/_app/products_/$productId')({ component: ProductEditor })
