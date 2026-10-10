import { createFileRoute } from '@tanstack/react-router'
import { OrderPage } from '../../features/orders/OrderPage'

export const Route = createFileRoute('/_app/orders_/$orderId')({ component: OrderPage })
