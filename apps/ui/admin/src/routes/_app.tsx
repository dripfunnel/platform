import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '../features/shell/AppShell'
import { loadShell, requireMe } from '../features/shell/loadShell'
import { ShellError } from '../features/shell/ShellError'

// The shell every signed-in screen sits in. `me` is read once here, before any loader, and a
// visitor with no session goes to /sign-in; the screens' loaders read it from the route context.
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => ({ me: await requireMe() }),
  loader: ({ context }) => loadShell(context.me),
  errorComponent: ShellError,
  component: AppShell,
})
