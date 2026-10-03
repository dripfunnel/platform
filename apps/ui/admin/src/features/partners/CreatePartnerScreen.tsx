import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { createPartner, type ActionPermission } from '../../api/partners'
import { isApiError } from '../../api/client'
import { messages } from '../../messages'
import { EmptyState, ListHeader, LoadingState, useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { failureText } from '../common/failure'
import { CreatePartnerForm } from './CreatePartnerForm'
import { draftErrors, emptyDraft, type DraftErrors, type PartnerDraft } from './partnerDraft'
import { refusalText } from './refusal'

const words = messages.partners.createForm
const createRoute = getRouteApi('/_app/partners_/new')

export const createPartnerStates = ['invalid', 'refused', 'denied'] as const
export type CreatePartnerState = (typeof createPartnerStates)[number]

// What each ?state= starts the form with (ui/README.md §6).
const harnessStart = (forced: CreatePartnerState | null): { draft: PartnerDraft; errors: DraftErrors } => {
  switch (forced) {
    case 'invalid':
      return { draft: { ...emptyDraft, ownerEmail: 'owner@' }, errors: draftErrors({ ...emptyDraft, ownerEmail: 'owner@' }) }
    case 'refused':
      return { draft: { name: 'Northstar Commerce', ownerEmail: 'owner@northstar.example', country: 'DE', invitation: 'send' }, errors: { name: 'NAME_TAKEN' } }
    default:
      return { draft: emptyDraft, errors: {} }
  }
}

// A refusal on the name lands on its field; any other is worded by its code, never its message.
export const refusalOf = (error: unknown): { errors: DraftErrors } | { failure: string } =>
  isApiError(error, 'NAME_TAKEN') ? { errors: { name: 'NAME_TAKEN' } } : { failure: failureText(error, words.failed) }

export interface CreatePartnerProps {
  permission: ActionPermission
  forced: CreatePartnerState | null
  onCreated: (id: string) => void
}

export const CreatePartner = ({ permission, forced, onCreated }: CreatePartnerProps) => {
  const [start] = useState(() => harnessStart(forced))
  const [errors, setErrors] = useState(start.errors)
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const refusal = refusalText(forced === 'denied' ? { allowed: false, reason: 'PARTNER_ADMINS_ONLY' } : permission, 'create', '')

  const onSubmit = (draft: PartnerDraft) => {
    setSubmitting(true)
    setFailure(null)
    createPartner({ name: draft.name.trim(), ownerEmail: draft.ownerEmail.trim(), country: draft.country, sendInvitation: draft.invitation === 'send' })
      .then(onCreated)
      .catch((error: unknown) => {
        setSubmitting(false)
        const refused = refusalOf(error)
        if ('errors' in refused) setErrors(refused.errors)
        else setFailure(refused.failure)
      })
  }

  return (
    <div className="df-page">
      <ListHeader level={words.level} title={words.title} sub={words.sub} />
      {refusal === null ? (
        <CreatePartnerForm initial={start.draft} errors={errors} failure={failure} submitting={submitting} onSubmit={onSubmit} />
      ) : (
        <EmptyState
          title={words.denied.title}
          body={refusal}
          action={
            <Link to="/partners" className="df-button">
              {words.denied.back}
            </Link>
          }
        />
      )}
    </div>
  )
}

export const CreatePartnerLoading = () => <LoadingState label={words.loading} />

export const CreatePartnerScreen = () => {
  const permission = createRoute.useLoaderData()
  const forced = useScreenState(createPartnerStates, harnessEnabled)
  const navigate = useNavigate()
  return <CreatePartner permission={permission} forced={forced} onCreated={(id) => void navigate({ to: '/partners/$partnerId', params: { partnerId: id } })} />
}
