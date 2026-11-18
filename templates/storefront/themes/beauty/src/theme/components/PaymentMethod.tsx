import { useStorefront } from '@dripfunnel/storefront-core/theme'

/** A way to pay, in the theme's words, from the provider the engine names. */
export const PaymentMethod = ({ provider }: { provider: string }) => {
  const { t } = useStorefront()
  return (
    <>
      {provider === 'cod'
        ? t('shop.checkout.methods.cod')
        : provider === 'bank_transfer'
          ? t('shop.checkout.methods.transfer')
          : provider === 'razorpay' || provider === 'cashfree'
            ? t('shop.checkout.methods.upi')
            : provider === 'phonepe'
              ? t('shop.checkout.methods.phonepe')
              : provider === 'paypal'
                ? t('shop.checkout.methods.paypal')
                : t('shop.checkout.methods.card')}
    </>
  )
}
