import { previewsState, redirectSignedIn } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { loadMe } from '../../api/me'
import { SignIn } from '../../features/sign-in/SignIn'
import { harnessEnabled } from '../../harness'

export const Route = createFileRoute('/_auth/sign-in')({
  beforeLoad: ({ location }) => redirectSignedIn({ loadMe, next: undefined, home: '/dashboard', skip: previewsState(harnessEnabled, location.searchStr) }),
  component: SignIn,
})
