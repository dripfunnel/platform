export const settingsTabs = ['company', 'team', 'payout', 'security', 'integrations'] as const
export type SettingsTab = (typeof settingsTabs)[number]

export const settingsStates = ['loading', 'error', 'readonly', 'notconnected', 'verifying', 'declined'] as const
export type SettingsState = (typeof settingsStates)[number]
export type PayoutState = Extract<SettingsState, 'notconnected' | 'verifying' | 'declined'>
