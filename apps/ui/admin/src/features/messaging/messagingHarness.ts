// States (?state=): loading, empty (no account saved), error, readonly (as a role without messaging.manage sees it).
// There is no denied state: every role reads the status.
export const messagingStates = ['loading', 'empty', 'error', 'readonly'] as const
export type MessagingScreenState = (typeof messagingStates)[number]
