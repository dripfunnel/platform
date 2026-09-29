import { messages } from '../../messages'
import { ConfirmDemo } from './ConfirmDemo'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { PermissionDenied } from './PermissionDenied'
import { ReadOnlyNotice } from './ReadOnlyNotice'
import type { ScreenState } from './screenState'

const words = messages.states

export const StateView = ({ state }: { state: ScreenState }) => {
  switch (state) {
    case 'empty':
      return (
        <EmptyState
          title={words.empty.title}
          body={words.empty.body}
          action={<button type="button" className="df-button df-button--primary">{words.empty.action}</button>}
        />
      )
    case 'loading':
      return <LoadingState label={words.loading.label} />
    case 'error':
      return (
        <ErrorState
          title={words.error.title}
          body={words.error.body}
          detailsLabel={words.error.detailsLabel}
          details={words.error.details}
          retry={{ label: words.error.retry, onRetry: () => undefined }}
        />
      )
    case 'denied':
      return <PermissionDenied actionLabel={words.denied.action} reason={words.denied.reason} />
    case 'readonly':
      return <ReadOnlyNotice title={words.readonly.title} body={words.readonly.body} />
    case 'confirm':
      return <ConfirmDemo />
  }
}
