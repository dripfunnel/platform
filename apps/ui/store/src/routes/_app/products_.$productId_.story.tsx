import { createFileRoute } from '@tanstack/react-router'
import { StoryEditor } from '../../features/productStory/StoryEditor'

export const Route = createFileRoute('/_app/products_/$productId_/story')({ component: StoryEditor })
