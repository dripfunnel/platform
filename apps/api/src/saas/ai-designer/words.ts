// The Storefront area's activity actions (LOGGING §3) and the codes its chat notes and errors store, which the portal
// words (#319): never the merchant's request or the AI's words in either.

export const designAudit = {
  templateChosen: 'storefront.template_chosen',
  designRequested: 'storefront.design_requested',
  changeUndone: 'storefront.change_undone',
  textEdited: 'storefront.text_edited',
  discarded: 'storefront.discarded',
} as const

export const designNotes = {
  /** "Switched to Linen", or "Started from scratch" for `baseline`. */
  templateChosen: (key: string) => `template:${key}`,
  undone: 'undone',
  discarded: 'discarded',
} as const

/** FIRST-RELEASE §14: "I couldn't make that change — nothing on your site changed." for both. */
export const designErrors = { refused: 'change_refused', failed: 'change_failed' } as const
