import { t } from '../../../messages'
import { sessionClient } from '../../../session'
import { ShellScreen } from '../../states/ShellScreen'
import { Skeleton } from '../../states/StateView'
import { stateOfError, useLoad } from '../../common/useLoad'
import { StoryEditor } from './StoryEditor'
import { loadStory } from './loadStory'

// A product's A+ content, with the states a screen designs: loading, a product that isn't here, no access, and "We couldn't load".
export function StoryScreen({ id }: { id: string }) {
  const client = sessionClient()
  const { state, reload } = useLoad(() => loadStory(client, id), [client, id])
  if (state.status === 'ready') return <StoryEditor client={client} data={state.data} />
  return (
    <ShellScreen label={t('products.story.title')} onRetry={reload} {...(state.status === 'error' ? { state: stateOfError(state.error) } : {})}>
      {state.status === 'loading' ? <Skeleton /> : null}
    </ShellScreen>
  )
}
