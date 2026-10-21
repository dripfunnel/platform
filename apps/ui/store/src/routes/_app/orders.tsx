import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { orderFilters } from '../../api/orders'
import { OrderList } from '../../features/orders/OrderList'

// `filter` is the chip a link from Home opens the list on (FIRST-RELEASE §5).
export const Route = createFileRoute('/_app/orders')({ validateSearch: z.looseObject({ filter: optionalParam(z.enum(orderFilters)) }), component: OrderList })
