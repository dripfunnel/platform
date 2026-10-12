import { idParam, optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StorefrontPage } from '../../features/storefront/StorefrontPage'
import { storefrontTabs, storefrontViews } from '../../features/storefront/storefrontAccess'

// `tab` is the Storefront tab (Design is the default), `view` a full-page step over it and `run` the publish the studio
// follows; never the harness's ?state=.
export const Route = createFileRoute('/_app/storefront')({ validateSearch: z.looseObject({ tab: optionalParam(z.enum(storefrontTabs)), view: optionalParam(z.enum(storefrontViews)), run: idParam }), component: StorefrontPage })
