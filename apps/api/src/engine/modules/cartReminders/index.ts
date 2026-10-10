// Abandoned carts and their reminders (FIRST-RELEASE §9; DATA-MODEL §7.2, §7.6). Only what other layers use is exported here.

import { defaultSteps } from './rules'

export { cartRemindKind, decideReminder, markAbandonedCarts, queueDueReminders, recoverCarts, type ReminderDecision } from './jobs'
export { restoreCart, unsubscribe, type LinkResult, type Restored } from './links'
export { cartRemindersAudit, createCartRemindersService, type ReminderSettingsView, type RemindersRefusal, type RemindersResult } from './service'
export { reminderDelays, reminderPercents, reminderWindowMs, type ReminderLevel, type ReminderSettingsInput, type ReminderStepView } from './rules'

/** The words a reminder sent before the store saved its own goes out with (the Reminders tab's first step). */
export const defaultReminderStep = defaultSteps[0] ?? { subject: '', body: '' }
