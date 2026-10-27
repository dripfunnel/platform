import { t } from '../../messages'
import type { DeliveryOption, PaymentOption } from '../../api/cart'
import { money } from '../catalogue/words'
import { isSheetProvider } from './payments/env'

/** The delivery option's name: the courier's own service name where the API gives one, otherwise the app's words for its kind. */
export const optionName = (option: DeliveryOption): string => {
  if (option.id === 'own_delivery') return t('checkout.delivery.own')
  if (option.id === 'pickup') return t('checkout.delivery.pickup')
  if (option.id === 'flat') return t('checkout.delivery.flat')
  return option.service ?? t('checkout.delivery.courier')
}

/** The line under the option's name: what it is, when it comes, or when to collect; null when the API gives nothing to say. */
export const optionNote = (option: DeliveryOption): string | null => {
  if (option.id === 'own_delivery') return t('checkout.delivery.ownNote')
  if (option.id === 'pickup') return option.hours ? t('checkout.delivery.pickupHours', { hours: option.hours }) : null
  if (option.minDays !== null && option.maxDays !== null) return option.minDays === option.maxDays ? t('checkout.delivery.daysSame', { count: option.maxDays }) : t('checkout.delivery.days', { min: option.minDays, max: option.maxDays })
  return null
}

export const optionPrice = (option: DeliveryOption): string => (option.amount ? (option.amount.amount === '0' ? t('checkout.delivery.free') : money(option.amount)) : '')

/** What the app can complete: cash on delivery, bank transfer, and every card or wallet provider in its own sheet. */
export const takesPayment = (option: PaymentOption): boolean => option.provider === 'cod' || option.provider === 'bank_transfer' || isSheetProvider(option.provider)

export const paymentName = (provider: string): string => {
  switch (provider) {
    case 'cod':
      return t('checkout.payment.cod')
    case 'bank_transfer':
      return t('checkout.payment.bank_transfer')
    case 'stripe':
      return t('checkout.payment.stripe')
    case 'paypal':
      return t('checkout.payment.paypal')
    case 'razorpay':
      return t('checkout.payment.razorpay')
    case 'cashfree':
      return t('checkout.payment.cashfree')
    case 'phonepe':
      return t('checkout.payment.phonepe')
    default:
      return t('checkout.payment.other')
  }
}
