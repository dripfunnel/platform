import { sessionClient } from '../../../session'
import { t } from '../../../messages'
import { Skeleton } from '../../states/StateView'
import { ShellScreen } from '../../states/ShellScreen'
import { stateOfError, useLoad } from '../useLoad'
import { loadEditor } from './loadEditor'
import { ProductForm } from './ProductForm'

// Opens a product, or a new one when `id` is null, with the states a screen designs: loading, a product that isn't here (or isn't
// the caller's, which looks the same), no access, and "We couldn't load" with a way to try again.
export function ProductEditorScreen({ id }: { id: string | null }) {
  const client = sessionClient()
  const { state, reload } = useLoad(() => loadEditor(client, id), [client, id])

  if (state.status === 'ready') return <ProductForm client={client} data={state.data} onReload={reload} />
  return (
    <ShellScreen label={t('products.title')} onRetry={reload} {...(state.status === 'error' ? { state: stateOfError(state.error) } : {})}>
      {state.status === 'loading' ? <Skeleton /> : null}
    </ShellScreen>
  )
}
