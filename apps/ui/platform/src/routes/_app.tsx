import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AppShell } from '../features/shell/AppShell'
import { loadShell } from '../features/shell/loadShell'

// No sign-in guard yet (#112 adds it): loadMe returns a fixture for every visitor. The search
// keeps every child's keys; only the harness's two are read here.
export const Route = createFileRoute('/_app')({
  validateSearch: z.looseObject({ partner: z.string().optional(), state: z.string().optional() }),
  loaderDeps: ({ search }) => ({ partner: search.partner, state: search.state }),
  loader: ({ deps }) => loadShell(deps),
  component: AppShell,
})
