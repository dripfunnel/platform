import { useCallback, useEffect, useRef, useState } from 'react'
import { confirmImport, loadImport, loadImports, startFileImport, startShopifyImport, type CatalogImport } from '../../api/imports'
import { loadWarehouses, type Warehouse } from '../../api/inventory'
import type { ApiClient } from '../../graphql'
import { errorMessage } from '../../messages/errorMessage'
import { checkPicked, CsvTooLarge, fileErrorOf, type FileError } from './importFile'
import { pickCsv, readCsv } from './files'

export const importPollMs = 2000

export type ImportMode = 'file' | 'shopify' | null
export type ImportStep = 'start' | 'pick' | 'check' | 'running' | 'done'

/** The Choose → Check → Import → Done steps of CatImport (FIRST-RELEASE.md §13), held for one screen; a run is found again when it opens. */
export function useImportFlow(client: ApiClient, supplier: boolean, canImport: boolean) {
  const [mode, setMode] = useState<ImportMode>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [job, setJob] = useState<CatalogImport | null>(null)
  const [run, setRun] = useState<CatalogImport | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<FileError | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [places, setPlaces] = useState<Warehouse[]>([])
  const live = useRef(true)
  const turn = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    if (!canImport) return
    loadWarehouses(client, supplier).then(
      (found) => live.current && setPlaces(found),
      () => undefined,
    )
    loadImports(client).then(
      (recent) => {
        const going = recent.find((found) => found.state === 'running')
        if (live.current && going) setRun((current) => current ?? going)
      },
      () => undefined,
    )
  }, [client, supplier, canImport])

  const runningId = run?.state === 'running' ? run.id : null
  useEffect(() => {
    if (runningId === null) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () =>
      void loadImport(client, runningId).then(
        (next) => {
          if (!current) return
          if (!next) return setRun(null)
          setRun(next)
          if (next.state === 'running') timer = setTimeout(check, importPollMs)
        },
        () => current && (timer = setTimeout(check, importPollMs)),
      )
    timer = setTimeout(check, importPollMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [client, runningId])

  // Each attempt (a picked file, a Shopify check) and each restart takes a new turn; an answer for an earlier turn is dropped,
  // so a check the person left can neither open the Check step nor overwrite a newer job.
  const stop = useCallback(() => {
    turn.current += 1
    clearTimeout(timer.current)
  }, [])

  const follow = useCallback(
    (id: string, name: string, mine: number) => {
      const current = () => live.current && turn.current === mine
      const later = (check: () => void) => {
        timer.current = setTimeout(check, importPollMs)
      }
      setChecking(true)
      const check = () =>
        void loadImport(client, id).then(
          (next) => {
            if (!current()) return
            if (next?.state === 'checking') return later(check)
            setChecking(false)
            if (!next) return setFileError({ kind: 'other', name })
            setPicking(null)
            if (next.state === 'unreadable') setFileError(fileErrorOf(next, name))
            else setJob(next)
          },
          () => current() && later(check),
        )
      check()
    },
    [client],
  )

  useEffect(() => stop, [stop])

  const chooseFile = async () => {
    setRefusal(null)
    const picked = await pickCsv().catch(() => null)
    if (!picked) return
    stop()
    const mine = turn.current
    setChecking(false)
    setMode('file')
    setJob(null)
    setFileName(picked.name)
    const refused = checkPicked(picked)
    if (refused) return setFileError(refused)
    setFileError(null)
    let text: string
    try {
      text = await readCsv(picked.uri)
    } catch (error) {
      if (turn.current === mine) setFileError(error instanceof CsvTooLarge ? { kind: 'big', name: picked.name, size: error.size } : { kind: 'unreadable', name: picked.name })
      return
    }
    try {
      const id = await startFileImport(client, text)
      if (turn.current === mine) follow(id, picked.name, mine)
    } catch (error) {
      if (turn.current !== mine) return
      setChecking(false)
      setFileError({ kind: 'other', name: picked.name })
      setRefusal(errorMessage(error, 'imports'))
    }
  }

  const checkShop = async (ids: string[] | null, shop: string) => {
    stop()
    const mine = turn.current
    setFileName(shop)
    setFileError(null)
    setRefusal(null)
    try {
      const id = await startShopifyImport(client, ids)
      if (turn.current === mine) follow(id, shop, mine)
    } catch (error) {
      if (turn.current !== mine) return
      setChecking(false)
      setFileError({ kind: 'other', name: shop })
      setRefusal(errorMessage(error, 'imports'))
    }
  }

  const confirm = async (matching: 'update' | 'skip', warehouseId: string | null) => {
    if (!job) return
    await confirmImport(client, job.id, matching, warehouseId)
    setRun({ ...job, state: 'running', done: 0 })
    setJob(null)
  }

  const restart = () => {
    stop()
    setRun(null)
    setMode(null)
    setJob(null)
    setPicking(null)
    setFileError(null)
    setRefusal(null)
    setChecking(false)
  }

  const step: ImportStep = run ? (run.state === 'running' ? 'running' : 'done') : job ? 'check' : picking ? 'pick' : 'start'
  return { step, mode, setMode, picking, setPicking, job, run, fileName, fileError, refusal, checking, places, chooseFile, checkShop, confirm, restart }
}
