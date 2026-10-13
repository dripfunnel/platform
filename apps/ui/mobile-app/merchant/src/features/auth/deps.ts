import { restOptions, session } from '../../session'
import { pendingStore } from './pending'
import type { FlowDeps } from './signInFlow'

export const flowDeps = (): FlowDeps => ({ rest: restOptions(), session: session(), pending: pendingStore })
