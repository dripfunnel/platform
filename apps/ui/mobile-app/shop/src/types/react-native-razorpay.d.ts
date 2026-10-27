// react-native-razorpay 3.0.0 ships no types: only what razorpay.ts passes and reads.
declare module 'react-native-razorpay' {
  export type RazorpayOptions = {
    key: string
    order_id: string
    amount: string
    currency: string
    name?: string
    prefill?: { email?: string; contact?: string }
  }

  const RazorpayCheckout: { open: (options: RazorpayOptions) => Promise<{ razorpay_payment_id: string }> }
  export { RazorpayCheckout as default }
}
