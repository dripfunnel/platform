// The Store API's stable codes (ACCESS.md §3.1, §4, scope.ts) and the three the app makes itself.
export const knownErrorCodes = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BLOCKED_WHILE_IMPERSONATING',
  'PARTNER_ENTERS_THIS_ITSELF',
  'STORE_REQUIRED',
  'SUPPLIER_REQUIRED',
  'STORE_SUSPENDED',
  'READ_ONLY',
  'SUPPORT_READ_ONLY',
  'BLOCKED_FOR_SUPPORT',
  'PLAN_LIMIT',
  'PLAN_LIMIT_REACHED',
  'NOT_CONNECTED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INVALID_INPUT',
  // The sign-in routes' refusals and My profile's (ACCESS.md §4); the sign-in ones carry `minutes` or `triesLeft` in details.
  'INVALID_CREDENTIALS',
  'LOCKED',
  'WRONG_CODE',
  'CODE_EXPIRED',
  'INVALID_PHONE',
  'INVALID_EMAIL',
  'NAME_REQUIRED',
  'WEAK_PASSWORD',
  'PHONE_REQUIRED',
  'PHONE_IN_USE_FOR_SIGN_IN',
  'SECOND_FACTOR_REQUIRED',
  // The catalogue's refusals (apps/api src/apis/store/products.ts, inventory.ts, approval.ts, story.ts, assets.ts).
  'CATEGORY_REFUSED',
  'TOO_MANY_OPTIONS',
  'TOO_MANY_VERSIONS',
  'OPTION_VALUES_REQUIRED',
  'DUPLICATE_OPTION',
  'DUPLICATE_VALUE',
  'VERSION_CHOICES',
  'DUPLICATE_VERSION',
  'VERSION_REQUIRED',
  'PRICE_REQUIRED',
  'INVALID_PRICE',
  'INVALID_BARCODE',
  'DUPLICATE_SKU',
  'CURRENCY_REQUIRED',
  'SUPPLIER_FIELD',
  'NOT_SHOWABLE',
  'STALE_REVISION',
  'TOO_MANY_PHOTOS',
  'INVALID_PHOTO',
  'INVALID_VIDEO',
  'FILE_REFUSED',
  'INVALID_FILTER',
  'INVALID_LISTING',
  'LISTING_REFUSED',
  'BELOW_ZERO',
  'REASON_REQUIRED',
  'INVALID_STORY',
  'STORY_REFUSED',
  'STORY_INCOMPLETE',
  'TOO_LARGE',
  'UNSUPPORTED_TYPE',
  'EMPTY',
  // Collections, filters, the menu and size charts (apps/api src/apis/store/structure.ts, listing.ts).
  'DUPLICATE_NAME',
  'FEATURE_UNAVAILABLE',
  'INVALID_LINK',
  'INVALID_PARENT',
  'INVALID_RULE',
  'TOO_DEEP',
  'TOO_MANY_COLLECTIONS',
  'TOO_MANY_FILTERS',
  'TOO_MANY_ITEMS',
  'TOO_MANY_PRODUCTS',
  'TOO_MANY_RULES',
  'TOO_MANY_SIZE_CHARTS',
  // Settings (apps/api src/apis/store/storeInfo.ts, people.ts, suppliers.ts, inventory.ts, tax.ts, markets.ts, src/engine/modules/catalog/settings.ts).
  'INVALID_TIME_ZONE',
  'INVALID_TAX_ID',
  'INVALID_LOGO',
  'ORDER_NUMBER_DOWN',
  'INVALID_CURRENCY',
  'INVALID_LANGUAGE',
  'MAIN_LANGUAGE_REQUIRED',
  'ALREADY_MEMBER',
  'LAST_OWNER',
  'DUPLICATE_SUPPLIER',
  'ALREADY_SUSPENDED',
  'NOT_SUSPENDED',
  'SUSPENDED',
  'TOO_MANY_WAREHOUSES',
  'DEFAULT_WAREHOUSE',
  'WAREHOUSE_HOLDS_STOCK',
  // Made by the app: no answer in time, an answer that is not the API's JSON, and a code it has no name for.
  'NO_RESPONSE',
  'BAD_RESPONSE',
  'UNKNOWN',
] as const

export type KnownErrorCode = (typeof knownErrorCodes)[number]

const known: ReadonlySet<string> = new Set(knownErrorCodes)

export class ApiError extends Error {
  readonly code: KnownErrorCode
  constructor(
    code: string | undefined,
    message: string,
    /** The refusal's other facts as the API sent them; unchecked data. */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.code = code !== undefined && known.has(code) ? (code as KnownErrorCode) : 'UNKNOWN'
  }
}

export const isApiError = (error: unknown, code?: KnownErrorCode): error is ApiError => error instanceof ApiError && (code === undefined || error.code === code)
