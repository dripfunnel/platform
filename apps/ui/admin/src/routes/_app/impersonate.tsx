import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { usersSearch } from '../../features/impersonate/impersonateSearch'
import { ImpersonateUsersScreen } from '../../features/impersonate/ImpersonateUsersScreen'

export const Route = createFileRoute('/_app/impersonate')({
  validateSearch: z.object(usersSearch),
  component: ImpersonateUsersScreen,
})
