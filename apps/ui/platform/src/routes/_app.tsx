import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AppShell } from '../features/shell/AppShell'
import { loadShell, requireMe } from '../features/shell/loadShell'
import { ShellError } from '../features/shell/ShellError'

// The shell every signed-in screen sits in. `me` is read once here, before any loader, and goes
// into the route context; only the harness's two keys are read from the address.
export const Route = createFileRoute('/_app')({
  validateSearch: z.looseObject({ partner: z.string().optional(), state: z.string().optional() }),
  beforeLoad: async ({ search, location }) => ({ me: await requireMe({ partner: search.partner, state: search.state }, location.href) }),
  loader: ({ context }) => loadShell(context.me),
  errorComponent: ShellError,
  component: AppShell,
})
