/* eslint-disable @typescript-eslint/no-require-imports -- loaded on first use: Expo Go has none of these SDKs, and importing one there can throw on iOS (shop/ARCHITECTURE.md §3) */
export const loadRazorpay = () => require('react-native-razorpay') as typeof import('react-native-razorpay')
export const loadCashfree = () => require('react-native-cashfree-pg-sdk') as typeof import('react-native-cashfree-pg-sdk')
export const loadPhonePe = () => require('react-native-phonepe-pg') as typeof import('react-native-phonepe-pg')
