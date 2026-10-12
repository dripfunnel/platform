import { idParam, optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StorefrontPage } from '../../features/storefront/StorefrontPage'
import { storefrontTabs, storefrontViews } from '../../features/storefront/storefrontAccess'
import { studioPathPattern } from '../../features/storefront/studioRules'

// `tab` is the Storefront tab (Design is the default), `view` a full-page step over it, `run` the publish the studio
// follows and `page` the path the studio opens on; never the harness's ?state=.
export const Route = createFileRoute('/_app/storefront')({
  validateSearch: z.looseObject({ tab: optionalParam(z.enum(storefrontTabs)), view: optionalParam(z.enum(storefrontViews)), run: idParam, page: optionalParam(z.string().regex(studioPathPattern)) }),
  component: StorefrontPage,
})
