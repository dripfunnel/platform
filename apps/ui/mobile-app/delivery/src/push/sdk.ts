/* eslint-disable @typescript-eslint/no-require-imports -- loaded only for a store that sets up push: Expo Go cannot do remote push on Android and logs an error on import */
export const loadNotifications = () => require('expo-notifications') as typeof import('expo-notifications')
