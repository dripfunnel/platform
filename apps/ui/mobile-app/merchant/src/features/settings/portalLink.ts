import { Linking } from 'react-native'
import { partnerDomain } from '../../graphql'

/** Where Stripe connects: Payment setup on the web portal (decided on #504; DESIGN.md §5), in the phone's browser, never an in-app web view. */
export const paymentsPortalPath = '/settings/payments'

export const portalUrl = (path: string): string => `https://${partnerDomain()}${path}`

export const openPortal = async (path: string): Promise<void> => {
  await Linking.openURL(portalUrl(path))
}
