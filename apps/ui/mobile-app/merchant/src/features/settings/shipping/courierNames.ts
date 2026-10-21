import { tryT } from '../../../messages'

// The couriers' own names and label sizes, as the API names them; one it has no words for shows as it is.
export const nameOf = (provider: string): string => tryT(`settings.shipping.couriers.${provider}`) ?? provider
export const labelSizeOf = (size: string): string => tryT(`settings.shipping.labelSizes.${size}`) ?? size
