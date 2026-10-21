import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AppShell } from '../features/shell/AppShell'
import { loadShell } from '../features/shell/loadShell'
import { ShellError } from '../features/shell/ShellError'

// The shell every signed-in screen sits in. The person and their acting store are read once here,
// before any screen's loader; only the harness's keys are read from the address.
export const Route = createFileRoute('/_app')({
  validateSearch: z.looseObject({ as: z.string().optional(), store: z.string().optional(), state: z.string().optional() }),
  loaderDeps: ({ search }) => ({ as: search.as, store: search.store }),
  loader: ({ deps, location }) => loadShell(deps, location.href),
  errorComponent: ShellError,
  component: AppShell,
})
