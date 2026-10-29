// The Storefront area's activity actions (LOGGING §3) and the codes its chat notes and errors store, which the portal
// words (#319): never the merchant's request or the AI's words in either.

export const designAudit = {
  templateChosen: 'storefront.template_chosen',
  designRequested: 'storefront.design_requested',
  changeUndone: 'storefront.change_undone',
  textEdited: 'storefront.text_edited',
  discarded: 'storefront.discarded',
  reverted: 'storefront.reverted',
  publishStarted: 'storefront.publish_started',
} as const

export const designNotes = {
  /** "Switched to Linen", or "Started from scratch" for `baseline`. */
  templateChosen: (key: string) => `template:${key}`,
  undone: 'undone',
  discarded: 'discarded',
} as const

/** FIRST-RELEASE §14: "I couldn't make that change — nothing on your site changed." for both. */
export const designErrors = { refused: 'change_refused', failed: 'change_failed', failedFor: (reason: DesignFailureReason | null) => (reason ? `change_failed:${reason}` : 'change_failed') } as const

/** Why the provider failed, kept in the stored error as `change_failed:{reason}` so the portal words it (SAAS.md §9.3). */
export const designFailureReasons = ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'SIGN_IN_EXPIRED', 'CREDENTIALS_REJECTED', 'BAD_REQUEST', 'DECLINED'] as const
export type DesignFailureReason = (typeof designFailureReasons)[number]
