import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadMe } from '../../api/me'
import { loadPartner } from '../../api/partners'
import { optionalParam } from '../../features/common/searchParams'
import { callerFor } from '../../features/partners/partnerHarness'
import { PartnerLoading } from '../../features/partners/PartnerDetail'
import { PartnerDetailScreen, PartnerRouteError } from '../../features/partners/PartnerDetailScreen'
import { partnerTabs } from '../../features/partners/PartnerTabs'

export const Route = createFileRoute('/_app/partners_/$partnerId')({
  validateSearch: z.object({ tab: optionalParam(z.enum(partnerTabs)) }),
  loader: async ({ params, location }) => {
    const me = await loadMe()
    return loadPartner(params.partnerId, callerFor(me.role, location.searchStr))
  },
  pendingComponent: PartnerLoading,
  errorComponent: PartnerRouteError,
  component: PartnerDetailScreen,
})
