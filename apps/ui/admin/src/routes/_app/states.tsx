import { createFileRoute, notFound } from '@tanstack/react-router'
import { StateGallery } from '../../features/common/StateGallery'
import { harnessEnabled } from '../../features/common/useScreenState'

export const Route = createFileRoute('/_app/states')({
  beforeLoad: () => {
    if (!harnessEnabled) throw notFound()
  },
  component: StateGallery,
})
