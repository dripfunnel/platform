import { idParam, optionalParam } from '@dripfunnel/shared/search'
import { z } from 'zod'
import { storefrontTabs, storefrontViews } from './storefrontAccess'

// `tab` is the Storefront tab (Design is the default), `view` a full-page step over it, `run` the publish the studio
// follows and `entry` the post open in its editor ('new' for one not saved); never the harness's ?state=. A value that doesn't fit is dropped.
export const storefrontSearch = z.looseObject({ tab: optionalParam(z.enum(storefrontTabs)), view: optionalParam(z.enum(storefrontViews)), run: idParam, entry: idParam })
