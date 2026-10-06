import { createFileRoute } from '@tanstack/react-router'
import { ProductList } from '../../features/products/ProductList'

export const Route = createFileRoute('/_app/products')({ component: ProductList })
