import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { offerKinds } from '../../api/offers'
import { OfferEditor } from '../../features/offers/OfferEditor'
import { recipes } from '../../features/offers/offerDraft'

// `type` skips the picker for one of the four kinds; `recipe` starts from a recipe (OFFERS-DESIGN V).
export const Route = createFileRoute('/_app/offers_/new')({ validateSearch: z.looseObject({ type: optionalParam(z.enum(offerKinds)), recipe: optionalParam(z.enum(recipes)) }), component: OfferEditor })
