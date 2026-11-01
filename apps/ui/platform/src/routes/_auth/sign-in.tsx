import { previewsState, redirectSignedIn } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadMe } from '../../api/me'
import { SignIn } from '../../features/auth/SignIn'
import { harnessEnabled } from '../../harness'

// `next` is where to go after sign-in, checked same-origin in api/auth.ts; `outcome` is the Worker's.
export const Route = createFileRoute('/_auth/sign-in')({
  validateSearch: z.looseObject({ next: z.string().optional(), outcome: z.string().optional(), state: z.string().optional() }),
  beforeLoad: ({ search, location }) => redirectSignedIn({ loadMe, next: search.next, home: '/dashboard', skip: previewsState(harnessEnabled, location.searchStr) }),
  component: () => <SignIn search={Route.useSearch()} />,
})
