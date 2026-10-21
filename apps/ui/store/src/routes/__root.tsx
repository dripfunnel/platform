import { createRootRoute, Outlet } from '@tanstack/react-router'
import { StaffSessionRoot } from '../features/staff-session/StaffSessionRoot'

const Root = () => (
  <>
    <StaffSessionRoot />
    <Outlet />
  </>
)

export const Route = createRootRoute({ component: Root })
