import { Component, type ReactNode } from 'react'
import { reportError } from '@dripfunnel/mobile-shared/crash'
import { StateMessage } from '../features/common/ui'
import { t } from '../messages'

type State = { failed: boolean }

/** Around the screens: one that throws is reported (scrubbed) and replaced by a message that says it can be tried again, instead of a blank app. */
export class CrashBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error): void {
    reportError(error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return <StateMessage title={t('crash.title')} body={t('crash.body')} actionLabel={t('common.retry')} onAction={() => this.setState({ failed: false })} />
  }
}
