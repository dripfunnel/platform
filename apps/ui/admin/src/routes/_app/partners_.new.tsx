import { createFileRoute } from '@tanstack/react-router'
import { messages } from '../../messages'
import { ScreenPlaceholder } from '../../features/shell/ScreenPlaceholder'

// Create partner is its own card (https://github.com/dripfunnel/platform/issues/61); the
// Partners list links here until it lands.
const CreatePartnerPlaceholder = () => <ScreenPlaceholder title={messages.partners.create} />

export const Route = createFileRoute('/_app/partners_/new')({ component: CreatePartnerPlaceholder })
