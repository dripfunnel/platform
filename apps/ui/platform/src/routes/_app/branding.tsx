import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadBranding } from '../../api/branding'
import { brandingTabs } from '../../features/branding/Branding'
import { BrandingPending, BrandingRouteError, BrandingScreen } from '../../features/branding/BrandingScreen'

// Branding is the signed-in partner's own, in every partner state (the checklist asks for it before Live).
export const Route = createFileRoute('/_app/branding')({
  validateSearch: z.looseObject({ tab: optionalParam(z.enum(brandingTabs)) }),
  loader: () => loadBranding(),
  pendingComponent: BrandingPending,
  errorComponent: BrandingRouteError,
  component: BrandingScreen,
})
