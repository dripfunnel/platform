import { Toast } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useState } from 'react'
import { loadImport, loadImports } from '../../api/imports'
import { fill, formatCount, messages } from '../../messages'
import { importRun, isRunning, useImportRun } from './importRun'

export const importPollMs = 2000

/** Mounted in the shell for an importer: finds a run still going after a reload, follows it on any screen, and says when it ends. */
export const ImportWatcher = () => {
  const run = useImportRun()
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    let live = true
    loadImports().then(
      (imports) => {
        const running = imports.find(isRunning)
        if (live && running && importRun.get() === null) importRun.set(running)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  const id = isRunning(run) ? run.id : null
  useEffect(() => {
    if (id === null) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () =>
      void loadImport(id).then(
        (next) => {
          if (!live || importRun.get()?.id !== id) return
          importRun.set(next)
          if (isRunning(next)) timer = setTimeout(check, importPollMs)
          else if (next?.state === 'done') setToast(fill(messages.imports.banner.finished, { added: formatCount(next.created), updated: formatCount(next.updated) }))
        },
        // Offline or the API away: the run carries on on the server, so look again.
        () => live && (timer = setTimeout(check, importPollMs)),
      )
    timer = setTimeout(check, importPollMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [id])

  return <Toast message={toast} onDone={clearToast} />
}
