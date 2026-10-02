import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadNavBadges } from '../api/navBadges'
import { AppShell } from '../features/shell/AppShell'
import { loadShellMe } from '../features/shell/loadShell'

// No sign-in guard yet (#112 adds it): loadMe returns a fixture for every visitor. `me` goes into
// the route context so every screen's loader knows the caller; only the harness's two keys are read.
export const Route = createFileRoute('/_app')({
  validateSearch: z.looseObject({ partner: z.string().optional(), state: z.string().optional() }),
  beforeLoad: async ({ search }) => ({ me: await loadShellMe({ partner: search.partner, state: search.state }) }),
  loader: async ({ context }) => ({ me: context.me, badges: await loadNavBadges(context.me.partner.state) }),
  component: AppShell,
})
