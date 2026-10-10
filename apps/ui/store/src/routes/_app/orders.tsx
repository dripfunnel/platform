import { createFileRoute } from '@tanstack/react-router'
import { OrderList } from '../../features/orders/OrderList'

export const Route = createFileRoute('/_app/orders')({ component: OrderList })
