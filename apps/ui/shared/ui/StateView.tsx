import { ConfirmDemo, type ConfirmDemoWords } from './ConfirmDemo'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { PermissionDenied } from './PermissionDenied'
import { ReadOnlyNotice } from './ReadOnlyNotice'
import type { ScreenState } from './screenState'

export interface StateWords {
  empty: { title: string; body: string; action: string }
  loading: { label: string }
  error: {
    title: string
    body: string
    detailsLabel: string
    codeLabel: string
    code: string
    requestIdLabel: string
    requestId: string
    retry: string
  }
  denied: { action: string; reason: string }
  readonly: { title: string; body: string }
  confirm: ConfirmDemoWords
}

export const StateView = ({ state, words }: { state: ScreenState; words: StateWords }) => {
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
          details={{
            label: words.error.detailsLabel,
            codeLabel: words.error.codeLabel,
            code: words.error.code,
            requestIdLabel: words.error.requestIdLabel,
            requestId: words.error.requestId,
          }}
          retry={{ label: words.error.retry, onRetry: () => undefined }}
        />
      )
    case 'denied':
      return <PermissionDenied actionLabel={words.denied.action} reason={words.denied.reason} />
    case 'readonly':
      return <ReadOnlyNotice title={words.readonly.title} body={words.readonly.body} />
    case 'confirm':
      return <ConfirmDemo words={words.confirm} />
  }
}
