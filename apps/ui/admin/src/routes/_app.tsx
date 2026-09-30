import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '../features/shell/AppShell'
import { loadShell } from '../features/shell/loadShell'

// No sign-in guard yet: loadMe returns a fixture for every visitor. Once #13 adds the session,
// a beforeLoad here redirects to /sign-in when there is no signed-in staff member
// (https://github.com/dripfunnel/platform/issues/13).
export const Route = createFileRoute('/_app')({ loader: loadShell, component: AppShell })
