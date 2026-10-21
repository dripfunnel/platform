import { isApiError } from '@dripfunnel/shared/graphql'
import { EmptyState, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { maxImportBytes, type CatalogImport } from '../../api/imports'
import type { Place } from '../../api/stock'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { ExportCard } from './ExportCard'
import { ImportCheck } from './ImportCheck'
import { ImportPick } from './ImportPick'
import { ImportDone, ImportRunning, ImportStopped } from './ImportProgress'
import { ImportStart, type FileError } from './ImportStart'
import { ImportSteps } from './ImportSteps'
import { importPollMs } from './ImportWatcher'
import { ImportApiContext, liveImportApi, useImportApi } from './importApi'
import { importRun, useImportRun } from './importRun'
import { importSearch } from './importSearch'
import { importSample, importStates, type ImportSample } from './importStates'
import { downloadCsv } from '../common/download'
import './imports.css'

const words = messages.imports
const shellRoute = getRouteApi('/_app')

export type Mode = 'file' | 'shopify' | null

/** The file's own refusal, as CatImport draws it: the four it names, and the API's words for the rest. */
const fileErrorOf = (job: CatalogImport, name: string): FileError => {
  const code = job.problems.find((p) => p.line === 0)?.code
  if (code === 'EMPTY') return { kind: 'empty', name }
  if (code === 'NO_NAME_COLUMN') return { kind: 'cols', name }
  return { kind: 'other', name, message: job.problems[0]?.message ?? '' }
}

/** Import & export (designs/CatImport.dc.html; FIRST-RELEASE §13): Choose → Check → Import → Done, and exports; ?state= per importStates.ts. */
export const ImportPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(importStates, harnessEnabled)
  const sample = useMemo(() => importSample(forced), [forced])
  const canImport = forced ? forced !== 'denied' : acting.permissions.includes('catalog.import')
  if (!canImport)
    return (
      <div className="df-import">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )
  return (
    <ImportApiContext.Provider value={sample?.api ?? liveImportApi}>
      <ImportFlow key={forced ?? 'live'} readOnly={forced ? forced === 'readOnly' : (state?.readOnly ?? false)} side={acting.seller ? 'supplier' : 'merchant'} sample={sample} />
    </ImportApiContext.Provider>
  )
}

const ImportFlow = ({ readOnly, side, sample }: { readOnly: boolean; side: 'merchant' | 'supplier'; sample: ImportSample | null }) => {
  const { confirmImport, finishShopifyConnect, loadImport, loadImportTemplate, loadPlaces, startFileImport, startShopifyImport } = useImportApi()
  const search = importSearch.catch({}).parse(useSearch({ strict: false }))
  const navigate = useNavigate()
  const liveRun = useImportRun()
  const run = sample ? sample.run : liveRun
  const [mode, setMode] = useState<Mode>(sample?.mode ?? null)
  const [picking, setPicking] = useState<string | null>(sample?.picking ?? null)
  const [job, setJob] = useState<CatalogImport | null>(sample?.job ?? null)
  const [fileName, setFileName] = useState(sample?.fileName ?? '')
  const [fileError, setFileError] = useState<FileError | null>(sample?.fileError ?? null)
  const [shopNote, setShopNote] = useState<'failed' | null>(null)
  const [checking, setChecking] = useState(sample?.checking ?? false)
  const [places, setPlaces] = useState<Place[]>([])
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    loadPlaces().then((all) => live.current && setPlaces(all.filter((p) => side === 'supplier' || p.supplierId === null)), () => undefined)
    return () => {
      live.current = false
    }
  }, [side, loadPlaces])

  // Back from Shopify (src/hooks/shopify.ts): a one-time key finishes the connection, then the picker opens.
  const { shopify, key } = search
  useEffect(() => {
    if (!shopify) return
    void navigate({ to: '/products/import', search: {}, replace: true })
    setMode('shopify')
    if (shopify === 'finish' && key)
      finishShopifyConnect(key).then(
        (shop) => live.current && setPicking(shop),
        () => live.current && setShopNote('failed'),
      )
    else setShopNote('failed')
  }, [shopify, key, navigate, finishShopifyConnect])

  const follow = (id: string, name: string) => {
    setChecking(true)
    const check = () =>
      void loadImport(id).then(
        (next) => {
          if (!live.current) return
          if (next?.state === 'checking') return void setTimeout(check, importPollMs)
          setChecking(false)
          if (!next) return setFileError({ kind: 'other', name, message: '' })
          setPicking(null)
          if (next.state === 'unreadable') setFileError(fileErrorOf(next, name))
          else setJob(next)
        },
        () => live.current && setTimeout(check, importPollMs),
      )
    check()
  }

  const chooseFile = async (file: File) => {
    setMode('file')
    setJob(null)
    setFileName(file.name)
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return setFileError({ kind: 'type', name: file.name })
    if (file.size > maxImportBytes) return setFileError({ kind: 'big', name: file.name, size: file.size })
    setFileError(null)
    try {
      follow(await startFileImport(await file.text()), file.name)
    } catch (error) {
      setFileError({ kind: 'other', name: file.name, message: isApiError(error) ? error.message : '' })
    }
  }

  const checkShop = async (ids: string[] | null, shop: string) => {
    setFileName(shop)
    setFileError(null)
    try {
      follow(await startShopifyImport(ids), shop)
    } catch (error) {
      setFileError({ kind: 'other', name: shop, message: isApiError(error) ? error.message : '' })
    }
  }

  const restart = () => {
    if (run && run.state !== 'running') importRun.set(null)
    setMode(null)
    setJob(null)
    setPicking(null)
    setFileError(null)
    setShopNote(null)
    setChecking(false)
  }

  const confirm = async (matching: 'update' | 'skip', warehouseId: string | null) => {
    if (!job) return
    await confirmImport(job.id, matching, warehouseId)
    importRun.set({ ...job, state: 'running', done: 0 })
  }

  const template = async () => downloadCsv(await loadImportTemplate(), words.sources.template.file)

  const mine = run && (job === null || run.id === job.id) ? run : null
  const step = mine ? (mine.state === 'running' ? 'running' : 'done') : job ? 'check' : picking ? 'pick' : 'start'

  return (
    <div className="df-import">
      <Link to="/products" className="df-import-back">
        {words.back}
      </Link>
      <div>
        <h1 className="df-page-title">{words.title}</h1>
        <p className="df-page-lede">{words.lede}</p>
      </div>
      <ImportSteps current={step === 'pick' ? 'start' : step} />
      {readOnly && (
        <p className="df-import-note" role="status">
          {words.readOnly}
        </p>
      )}

      {step === 'start' && (
        <ImportStart mode={mode} readOnly={readOnly} checking={checking} fileError={fileError} shopNote={shopNote} onMode={setMode} onFile={chooseFile} onTemplate={template} onConnected={setPicking} />
      )}
      {step === 'pick' && picking && <ImportPick shop={picking} checking={checking} onBack={restart} onCheck={(ids) => checkShop(ids, picking)} />}
      {step === 'check' && job && <ImportCheck job={job} name={fileName} readOnly={readOnly} places={places} onRestart={restart} onRun={confirm} />}
      {step === 'running' && mine && <ImportRunning run={mine} />}
      {step === 'done' && mine && (mine.state === 'done' ? <ImportDone run={mine} onRestart={restart} /> : <ImportStopped run={mine} onRestart={restart} />)}

      <ExportCard />
    </div>
  )
}
