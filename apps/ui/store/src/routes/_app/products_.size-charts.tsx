import { createFileRoute } from '@tanstack/react-router'
import { SupplierSizeChartsPage } from '../../features/collections/SupplierSizeChartsPage'

export const Route = createFileRoute('/_app/products_/size-charts')({ component: SupplierSizeChartsPage })
