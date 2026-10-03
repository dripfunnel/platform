export const invitationChoices = ['send', 'hold'] as const
export type InvitationChoice = (typeof invitationChoices)[number]

export interface PartnerDraft {
  name: string
  ownerEmail: string
  country: string
  invitation: InvitationChoice
}

export type DraftField = 'name' | 'ownerEmail' | 'country'
export type DraftError = 'nameRequired' | 'nameTooLong' | 'emailInvalid' | 'countryRequired' | 'NAME_TAKEN'
export type DraftErrors = Partial<Record<DraftField, DraftError>>

export const emptyDraft: PartnerDraft = { name: '', ownerEmail: '', country: '', invitation: 'send' }

// The fields in the order they're shown, so focus goes to the first one in error.
export const draftFields: readonly DraftField[] = ['name', 'ownerEmail', 'country']

// A courtesy: the API's createPartnerInput is the rule, and refuses whatever slips past this.
export const draftErrors = (draft: PartnerDraft): DraftErrors => {
  const name = draft.name.trim()
  const email = draft.ownerEmail.trim()
  return {
    ...(name === '' ? { name: 'nameRequired' as const } : name.length > 120 ? { name: 'nameTooLong' as const } : {}),
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? {} : { ownerEmail: 'emailInvalid' as const }),
    ...(draft.country === '' ? { country: 'countryRequired' as const } : {}),
  }
}
