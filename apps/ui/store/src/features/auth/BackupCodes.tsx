import { messages } from '../../messages'
import { AuthFrame } from './AuthFrame'
import { BackupCodeList, downloadCodes } from '../common/BackupCodes'
import { Secondary } from './fields'

const words = messages.auth.codes

// The ten backup codes, shown once, at the end of setting up two-step sign-in (ACCESS.md §4,
// ui/README.md §3); PortalProfile's "Save your backup codes" view.
export const BackupCodes = ({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) => (
  <AuthFrame panel="in" title={words.title} sub={words.sub} icon={{ name: 'hash', tone: 'info' }}>
    <BackupCodeList codes={codes} />
    <Secondary onClick={() => downloadCodes(codes)}>{words.download}</Secondary>
    <button type="button" className="df-auth-primary" onClick={onDone}>
      {words.done}
    </button>
  </AuthFrame>
)
