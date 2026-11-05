import { createFileRoute } from '@tanstack/react-router'
import { WishlistShopperPage } from '../../features/carts/WishlistShopperPage'

export const Route = createFileRoute('/_app/carts_/wishlist/$customerId')({ component: WishlistShopperPage })
