const day = 24 * 60 * 60 * 1000

/** Whole days left in a trial, today's counted; null when the store isn't in one. */
export const trialDaysLeft = (trialEndsAt: string | null, now: Date): number | null =>
  trialEndsAt === null ? null : Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / day))
