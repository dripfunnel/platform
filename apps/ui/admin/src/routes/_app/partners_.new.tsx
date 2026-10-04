import { createFileRoute } from '@tanstack/react-router'
import { loadCreatePermission } from '../../api/partners'
import { CreatePartnerLoading, CreatePartnerScreen } from '../../features/partners/CreatePartnerScreen'
import { PartnersRouteError } from '../../features/partners/PartnersScreen'

export const Route = createFileRoute('/_app/partners_/new')({
  loader: () => loadCreatePermission(),
  pendingComponent: CreatePartnerLoading,
  errorComponent: PartnersRouteError,
  component: CreatePartnerScreen,
})
