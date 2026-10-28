import { StartupError as SharedStartupError } from '@dripfunnel/mobile-shared/brand'
import { t } from '../messages'

export const StartupError = ({ onRetry }: { onRetry: () => void }) => <SharedStartupError title={t('startup.failed')} retryLabel={t('startup.retry')} onRetry={onRetry} />
