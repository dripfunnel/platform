import { createFileRoute } from '@tanstack/react-router'
import { WarehousesPage } from '../../features/warehouses/WarehousesPage'

export const Route = createFileRoute('/_app/products_/warehouses')({ component: WarehousesPage })
