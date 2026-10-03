import { parseScreenState } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { invitation } from '../../api/auth'
import { AcceptInvite } from '../../features/auth/AcceptInvite'
import { AuthPending } from '../../features/auth/AuthPending'
import { acceptInviteStates, sampleInvitation } from '../../features/auth/authStates'
import { harnessEnabled } from '../../harness'

export const Route = createFileRoute('/_auth/accept-invite')({
  validateSearch: z.looseObject({ token: z.string().optional(), state: z.string().optional() }),
  loaderDeps: ({ search }) => ({ token: search.token, state: search.state }),
  loader: ({ deps }) => {
    const forced = harnessEnabled ? parseScreenState(deps.state, acceptInviteStates) : null
    return forced ? sampleInvitation(forced) : invitation(deps.token)
  },
  pendingComponent: AuthPending,
  component: () => <AcceptInvite search={Route.useSearch()} loaded={Route.useLoaderData()} />,
})
