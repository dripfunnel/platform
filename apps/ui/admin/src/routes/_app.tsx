import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '../features/shell/AppShell'
import { loadShell } from '../features/shell/loadShell'

export const Route = createFileRoute('/_app')({ loader: loadShell, component: AppShell })
