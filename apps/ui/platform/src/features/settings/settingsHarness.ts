export const settingsTabs = ['company', 'team', 'payout', 'security'] as const
export type SettingsTab = (typeof settingsTabs)[number]

export const settingsStates = ['loading', 'error', 'readonly'] as const
export type SettingsState = (typeof settingsStates)[number]
