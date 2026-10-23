import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'

/** The API's refusal in the merchant's words; a plan's limit on live offers says how many the plan allows. */
export const offerRefusal = (error: unknown): string => {
  if (isApiError(error, 'PLAN_LIMIT') && error.details['key'] === 'live_offers' && typeof error.details['limit'] === 'number') return t('offers.refused.liveLimit', { count: error.details['limit'] })
  return errorMessage(error, 'offers')
}
