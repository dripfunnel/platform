import { useState } from 'react'
import { t } from '../../messages'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { shareCsv } from '../common/shareCsv'

/** The file of what didn't go in, offered when the API has one: opened in the share sheet as text (decided on #503). */
export function ShareProblems({ csv }: { csv: string | null }) {
  const [failed, setFailed] = useState(false)
  if (csv === null) return null
  const share = async () => {
    setFailed(false)
    try {
      await shareCsv(t('imports.done.problemsHead'), csv)
    } catch {
      setFailed(true)
    }
  }
  return (
    <>
      {failed ? <Notice kind="error" text={t('imports.export.shareFailed')} /> : null}
      <Button kind="secondary" label={t('imports.done.share')} onPress={() => void share()} />
    </>
  )
}
