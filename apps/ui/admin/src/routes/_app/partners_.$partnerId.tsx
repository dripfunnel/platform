import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadPartner } from '../../api/partners'
import { activityTabSearch } from '../../features/common/activitySearch'
import { optionalParam } from '@dripfunnel/shared/search'
import { PartnerLoading } from '../../features/partners/PartnerDetail'
import { PartnerDetailScreen, PartnerRouteError } from '../../features/partners/PartnerDetailScreen'
import { partnerTabs } from '../../features/partners/PartnerTabs'

export const Route = createFileRoute('/_app/partners_/$partnerId')({
  validateSearch: z.object({ tab: optionalParam(z.enum(partnerTabs)), ...activityTabSearch }),
  loader: ({ params }) => loadPartner(params.partnerId),
  pendingComponent: PartnerLoading,
  errorComponent: PartnerRouteError,
  component: PartnerDetailScreen,
})
