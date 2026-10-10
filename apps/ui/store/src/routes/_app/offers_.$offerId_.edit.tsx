import { createFileRoute } from '@tanstack/react-router'
import { OfferEditor } from '../../features/offers/OfferEditor'

export const Route = createFileRoute('/_app/offers_/$offerId_/edit')({ component: OfferEditor })
