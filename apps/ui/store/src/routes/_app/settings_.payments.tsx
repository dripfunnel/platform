import { createFileRoute, redirect } from '@tanstack/react-router'
import { settingsSearch } from '../../features/settings/settingsSearch'

// Where Stripe's way back lands (apps/api/src/hooks/stripeConnect.ts): Payment setup, with Stripe's answer.
export const Route = createFileRoute('/_app/settings_/payments')({
  validateSearch: settingsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/settings', search: { tab: 'payments', stripe: search.stripe, key: search.key }, replace: true })
  },
})
