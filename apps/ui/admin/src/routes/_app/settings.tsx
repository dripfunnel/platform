import { createFileRoute } from '@tanstack/react-router'
import { loadMessaging } from '../../api/messaging'
import { MessagingLoading } from '../../features/messaging/Messaging'
import { MessagingRouteError, MessagingScreen } from '../../features/messaging/MessagingScreen'

// Platform settings: Messaging is its first and only screen so far (CONSOLE-DESIGN §R, #1544).
export const Route = createFileRoute('/_app/settings')({
  loader: () => loadMessaging(),
  pendingComponent: MessagingLoading,
  errorComponent: MessagingRouteError,
  component: MessagingScreen,
})
