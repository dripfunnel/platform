import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ChooseStore } from '../features/choose-store/ChooseStore'

const Chooser = () => {
  const { next, as } = Route.useSearch()
  return <ChooseStore next={next} as={as} />
}

export const Route = createFileRoute('/stores')({ validateSearch: z.object({ next: z.string().optional(), as: z.string().optional() }), component: Chooser })
