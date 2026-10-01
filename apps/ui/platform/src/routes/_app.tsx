import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '../features/shell/AppShell'
import { loadShell } from '../features/shell/loadShell'

// No sign-in guard yet: loadMe returns a fixture for every visitor. #112 adds partner sign-in
// and a beforeLoad here that redirects to /sign-in without a session.
export const Route = createFileRoute('/_app')({
  loaderDeps: ({ search }) => ({ searchStr: new URLSearchParams(search as Record<string, string>).toString() }),
  loader: ({ deps }) => loadShell(deps),
  component: AppShell,
})
