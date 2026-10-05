import { messages } from '../../messages'
import { AuthFrame } from './AuthFrame'
import { Secondary } from './fields'

const words = messages.auth.codes

/** A plain text file of the codes, made in the browser: the codes never go anywhere else. */
const download = (codes: readonly string[]) => {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: words.fileName })
  link.click()
  URL.revokeObjectURL(url)
}

// The ten backup codes, shown once, at the end of setting up two-step sign-in (ACCESS.md §4,
// ui/README.md §3); PortalProfile's "Save your backup codes" view.
export const BackupCodes = ({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) => (
  <AuthFrame panel="in" title={words.title} sub={words.sub} icon={{ name: 'hash', tone: 'info' }}>
    <ul className="df-auth-codes">
      {codes.map((code) => (
        <li key={code}>{code.toUpperCase()}</li>
      ))}
    </ul>
    <Secondary onClick={() => download(codes)}>{words.download}</Secondary>
    <button type="button" className="df-auth-primary" onClick={onDone}>
      {words.done}
    </button>
  </AuthFrame>
)
