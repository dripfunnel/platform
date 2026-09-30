import { createFileRoute } from '@tanstack/react-router'
import { StoreDetail } from '../../features/stores/StoreDetail'

export const Route = createFileRoute('/_app/stores_/$storeId')({ component: StoreDetail })
