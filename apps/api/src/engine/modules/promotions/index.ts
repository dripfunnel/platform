// Offers (OFFERS-DESIGN; DATA-MODEL §7.7): the definition every offer is held to, and the pure pricing of a cart's offers.

export {
  classOf,
  codeAnswerOf,
  combinesWithNothing,
  localTimeIn,
  maxConditions,
  namedIds,
  needsGroupOffers,
  normaliseCode,
  offerSchema,
  parseAction,
  parseCondition,
  statusOf,
  toStored,
  type Action,
  type CodeAnswer,
  type Combines,
  type Condition,
  type LocalTime,
  type OfferClass,
  type OfferDefinition,
  type OfferInput,
  type OfferStatus,
} from './definition'
export { priceOffers, type AppliedOffer, type NotApplied, type PricingInput, type PricingLine, type PricingOffer, type PricingResult, type PricingShopper } from './pricing'
export { buildOfferCodesExport, createOfferCodesExport, offerCodesExportAudit, type OfferCodesExportDto } from './exports'
export { createOffersService, maxBatchSize, maxCodesPerOffer, offersAudit, randomCodes, resultsDays, type CodeBatchRow, type CodeCheck, type CodeHolder, type OfferResults, type OfferFilter, type OfferKind, type OfferPlanKey, type OffersDeps, type OffersPlan, type OffersRefusal, type OffersResult, type OfferStatusFilter, type OfferView } from './service'
