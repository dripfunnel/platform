import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { offerTabs } from '../../api/offers'
import { OffersPage } from '../../features/offers/OffersPage'

// `status` is the tab (Live is the default); lists filter by ?status=, never the harness's ?state= (ui/README.md §6).
export const Route = createFileRoute('/_app/offers')({ validateSearch: z.looseObject({ status: optionalParam(z.enum(offerTabs)) }), component: OffersPage })
