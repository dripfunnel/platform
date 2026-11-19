import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { cartTabs } from '../../api/carts'
import { CartsPage } from '../../features/carts/CartsPage'

// `status` is the Carts tab (In progress is the default), `pane=reminders` the Reminders tab, `pane=wishlists` the Wishlists tab, `pane=wishlist-reminders` its Reminders; never the harness's ?state=.
export const Route = createFileRoute('/_app/carts')({ validateSearch: z.looseObject({ status: optionalParam(z.enum(cartTabs)), pane: optionalParam(z.enum(['reminders', 'wishlists', 'wishlist-reminders'])) }), component: CartsPage })
