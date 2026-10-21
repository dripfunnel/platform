// Extend trial's choices (ui/platform/FIRST-RELEASE.md §6.4), each counted from the later of the
// trial's end and now: the offers the store page shows and the rule extendTrial applies are one.
export const trialChoices = [3, 7, 14] as const
export type TrialChoice = (typeof trialChoices)[number]

const dayMs = 24 * 60 * 60 * 1000

export const trialEndAfter = (trialEndsAt: Date | null, days: TrialChoice, at: Date): Date => {
  const from = trialEndsAt && trialEndsAt > at ? trialEndsAt : at
  return new Date(from.getTime() + days * dayMs)
}
