import { messages } from '../../messages'

const words = messages.auth.codes

/** A plain text file of the codes, made in the browser: the codes never go anywhere else. */
export const downloadCodes = (codes: readonly string[]) => {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: words.fileName })
  link.click()
  URL.revokeObjectURL(url)
}

/** The ten backup codes as sign-in's set-up and My profile both show them (ACCESS.md §4). */
export const BackupCodeList = ({ codes }: { codes: readonly string[] }) => (
  <ul className="df-auth-codes">
    {codes.map((code) => (
      <li key={code}>{code.toUpperCase()}</li>
    ))}
  </ul>
)
