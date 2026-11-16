import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { loadImport } from '../../api/imports'
import { addSampleCatalog } from '../../api/shopCategory'
import { importRun, isRunning } from '../imports/importRun'
import { harnessSearch } from '../../harness'
import { messages } from '../../messages'
import { refusalIn } from './refusal'

const words = messages.sampleCatalog
const refusalOf = refusalIn(words.refused)

/** How long "Add sample catalog" waits for the sample to be in before opening Products; past it the import banner follows the rest. */
export const sampleWaitMs = 60_000
const pollMs = 1500

/** "Add sample catalog" (CATALOG-DESIGN A4, K13a): imports the category's sample straight away, then opens Products with it. */
export const SampleCatalogAction = ({ className = 'df-button' }: { className?: string }) => {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const add = async () => {
    setBusy(true)
    setFailure(null)
    let job: string
    try {
      job = await addSampleCatalog()
    } catch (error) {
      setFailure(refusalOf(error))
      setBusy(false)
      return
    }
    const until = Date.now() + sampleWaitMs
    let state = await loadImport(job).catch(() => null)
    while (state && (state.state === 'checking' || state.state === 'running') && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      state = await loadImport(job).catch(() => state)
    }
    if (state?.state === 'failed' || state?.state === 'unreadable') {
      setFailure(words.refused.other)
      setBusy(false)
      return
    }
    // Still going after the wait: the shell's banner follows it to the end (ImportWatcher).
    if (state && isRunning(state)) importRun.set(state)
    void navigate({ to: '/products', search: (prev) => harnessSearch(prev) })
  }
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => void add()}>
        {busy ? words.adding : words.add}
      </button>
      {failure && (
        <p className="df-sample-failure" role="alert">
          {failure}
        </p>
      )}
    </>
  )
}
