/* eslint-disable @typescript-eslint/no-require-imports -- loaded only for a store with its Firebase files: Expo Go has no Firebase module and fails on import (shop/ARCHITECTURE.md §3) */
export const loadCrashlytics = () => require('@react-native-firebase/crashlytics') as typeof import('@react-native-firebase/crashlytics')

/** The unhandled-rejection tracker React Native's promises and Crashlytics' own handler both use (the `promise` package, which the app depends on to reach it). It has no types. */
export type RejectionTracking = { enable: (options: { allRejections?: boolean; onUnhandled?: (id: number, error: unknown) => void }) => void }
export const loadRejectionTracking = () => require('promise/setimmediate/rejection-tracking') as RejectionTracking
