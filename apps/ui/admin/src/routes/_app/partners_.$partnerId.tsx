import { createFileRoute } from '@tanstack/react-router'
import { PartnerDetail } from '../../features/partners/PartnerDetail'

export const Route = createFileRoute('/_app/partners_/$partnerId')({ component: PartnerDetail })
