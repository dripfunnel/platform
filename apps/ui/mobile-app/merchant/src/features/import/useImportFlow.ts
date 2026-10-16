import { useCallback, useEffect, useRef, useState } from 'react'
import { confirmImport, loadImport, loadImports, startFileImport, startShopifyImport, type CatalogImport } from '../../api/imports'
import { loadWarehouses, type Warehouse } from '../../api/inventory'
import type { ApiClient } from '../../graphql'
import { errorMessage } from '../../messages/errorMessage'
import { checkPicked, fileErrorOf, type FileError } from './importFile'
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

  const follow = useCallback(
    (id: string, name: string) => {
      setChecking(true)
      const check = () =>
        void loadImport(client, id).then(
          (next) => {
            if (!live.current) return
            if (next?.state === 'checking') return void setTimeout(check, importPollMs)
            setChecking(false)
            if (!next) return setFileError({ kind: 'other', name })
            setPicking(null)
            if (next.state === 'unreadable') setFileError(fileErrorOf(next, name))
            else setJob(next)
          },
          () => live.current && setTimeout(check, importPollMs),
        )
      check()
    },
    [client],
  )

  const chooseFile = async () => {
    setRefusal(null)
    const picked = await pickCsv().catch(() => null)
    if (!picked) return
    setMode('file')
    setJob(null)
    setFileName(picked.name)
    const refused = checkPicked(picked)
    if (refused) return setFileError(refused)
    setFileError(null)
    const text = await readCsv(picked.uri).catch(() => null)
    if (text === null) return setFileError({ kind: 'unreadable', name: picked.name })
    try {
      follow(await startFileImport(client, text), picked.name)
    } catch (error) {
      setChecking(false)
      setFileError({ kind: 'other', name: picked.name })
      setRefusal(errorMessage(error, 'imports'))
    }
  }

  const checkShop = async (ids: string[] | null, shop: string) => {
    setFileName(shop)
    setFileError(null)
    setRefusal(null)
    try {
      follow(await startShopifyImport(client, ids), shop)
    } catch (error) {
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
