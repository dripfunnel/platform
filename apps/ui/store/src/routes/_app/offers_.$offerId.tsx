import { createFileRoute } from '@tanstack/react-router'
import { OfferPage } from '../../features/offers/OfferPage'

export const Route = createFileRoute('/_app/offers_/$offerId')({ component: OfferPage })
