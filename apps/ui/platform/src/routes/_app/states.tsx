import { createFileRoute, notFound } from '@tanstack/react-router'
import { StateGallery } from '../../features/states/StateGallery'
import { harnessEnabled } from '../../harness'

export const Route = createFileRoute('/_app/states')({
  beforeLoad: () => {
    if (!harnessEnabled) throw notFound()
  },
  component: StateGallery,
})
