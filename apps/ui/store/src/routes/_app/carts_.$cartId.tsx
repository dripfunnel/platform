import { createFileRoute } from '@tanstack/react-router'
import { CartPage } from '../../features/carts/CartPage'

export const Route = createFileRoute('/_app/carts_/$cartId')({ component: CartPage })
