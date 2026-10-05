import { createFileRoute } from '@tanstack/react-router'
import { ScreenPlaceholder } from '../../features/shell/ScreenPlaceholder'

// The editor (CatEditor) is SUI 4 part 3; `new` opens an empty one.
export const Route = createFileRoute('/_app/products_/$productId')({ component: () => <ScreenPlaceholder screen="products" /> })
