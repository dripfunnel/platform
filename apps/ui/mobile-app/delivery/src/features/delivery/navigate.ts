import { Linking, Platform } from 'react-native'

export type Pin = { latitude: number; longitude: number }

const named = (label: string): string => encodeURIComponent(label.replace(/[()]/g, ''))

/** Where the phone's map app is sent: Apple Maps on iOS, whichever app takes a `geo:` link on Android (usually Google Maps). */
export const mapUrl = (os: typeof Platform.OS, { latitude, longitude }: Pin, label: string): string =>
  os === 'ios' ? `http://maps.apple.com/?daddr=${latitude},${longitude}&q=${named(label)}` : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${named(label)})`

export const navigateTo = (pin: Pin, label: string): Promise<void> => Linking.openURL(mapUrl(Platform.OS, pin, label))

export const dial = (phone: string): Promise<void> => Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`)
