// Offers (OFFERS-DESIGN; DATA-MODEL §7.7). Only what other modules use is exported here; definition.ts, pricing.ts, service.ts, exports.ts and cart.ts hold the rest.

export { normaliseCode, type Action, type Condition, type OfferInput } from './definition'
export { cartOffers, deadCodeStates, type CartDiscount, type CartOffersInput, type CodeState } from './cart'
export { buildOfferCodesExport, createOfferCodesExport, offerCodesExportAudit, type OfferCodesExportDto } from './exports'
export { createOffersService, offersAudit, type CodeBatchRow, type CodeCheck, type OfferKind, type OfferResults, type OffersRefusal, type OffersResult, type OfferStatusFilter, type OfferView } from './service'
