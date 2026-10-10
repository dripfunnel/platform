// Offers (OFFERS-DESIGN; DATA-MODEL §7.7). Only what other modules use is exported here; definition.ts, pricing.ts, service.ts and exports.ts hold the rest.

export type { Action, Condition, OfferInput } from './definition'
export { buildOfferCodesExport, createOfferCodesExport, offerCodesExportAudit, type OfferCodesExportDto } from './exports'
export { createOffersService, offersAudit, type CodeBatchRow, type CodeCheck, type OfferKind, type OfferResults, type OffersRefusal, type OffersResult, type OfferStatusFilter, type OfferView } from './service'
