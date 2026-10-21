import { createFileRoute } from '@tanstack/react-router'
import { TeamPage } from '../../features/supplierTeam/TeamPage'

export const Route = createFileRoute('/_app/team')({ component: TeamPage })
