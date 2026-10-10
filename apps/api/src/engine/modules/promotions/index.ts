// Offers (OFFERS-DESIGN; DATA-MODEL §7.7). Only what other modules use is exported here; definition.ts, pricing.ts and service.ts hold the rest.

export type { Action, Condition, OfferInput } from './definition'
export { createOffersService, offersAudit, type OfferKind, type OffersRefusal, type OffersResult, type OfferStatusFilter, type OfferView } from './service'
