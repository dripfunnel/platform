import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { productFilters } from '../../api/products'
import { ProductList } from '../../features/products/ProductList'

// `filter` is the chip a link from Home opens the list on (FIRST-RELEASE §5).
export const Route = createFileRoute('/_app/products')({ validateSearch: z.looseObject({ filter: optionalParam(z.enum(productFilters)) }), component: ProductList })
