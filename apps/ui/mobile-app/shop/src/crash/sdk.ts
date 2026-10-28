/* eslint-disable @typescript-eslint/no-require-imports -- loaded only for a store with its Firebase files: Expo Go has no Firebase module and fails on import (shop/ARCHITECTURE.md §3) */
export const loadCrashlytics = () => require('@react-native-firebase/crashlytics') as typeof import('@react-native-firebase/crashlytics')
