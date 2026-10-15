import { t } from '../../messages'
import { sessionClient } from '../../session'
import { stateOfError, useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { collectionsAccess } from './access'
import { CollectionForm } from './CollectionForm'
import { loadCollectionEditor } from './loadEditor'

type Props = { id: string | null; suggested: string | null }

// Opens one collection, or a new one (`id` null). A collection that isn't here, or that this seat can't read, is the shell's 404 or
// access-denied view (DESIGN.md §4).
export function CollectionEditorScreen({ id, suggested }: Props) {
  const client = sessionClient()
  const { state: shell } = useShell()
  const { state, reload } = useLoad(() => loadCollectionEditor(client, id), [client, id])
  const denied = state.status === 'ready' && !collectionsAccess(state.data.access, shell?.readOnly === true).canRead
  if (state.status === 'ready' && !denied) return <CollectionForm client={client} data={state.data} suggested={suggested} />
  return (
    <ShellScreen label={t('collections.screen')} onRetry={reload} {...(state.status === 'error' ? { state: stateOfError(state.error) } : denied ? { state: 'denied' as const } : {})}>
      <Skeleton />
    </ShellScreen>
  )
}
