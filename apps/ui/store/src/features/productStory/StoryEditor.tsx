import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Toast, useScreenState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useBlocker, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadProduct, loadProductBasics } from '../../api/productEditor'
import { copyProductStory, gapsOf, loadProductStory, loadStoryBlocks, publishProductStory, saveProductStory, type ProductStory, type StoryGap } from '../../api/story'
import { harnessEnabled } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { ProductSearch } from '../common/ProductSearch'
import { editorAccessOf } from '../common/access'
import { StoryCanvas } from './StoryCanvas'
import { StoryPanel } from './StoryPanel'
import { blankModule, duplicateModule, maxModules, moduleInput, modulesOf, moved, sameModules, storyKinds, storyTemplates, type DraftModule, type StoryKind, type StoryTemplate } from './storyDraft'
import { storySample, storyStates } from './storyStates'
import './story.css'
import { refusalIn } from '../common/refusal'

const words = messages.story
const shellRoute = getRouteApi('/_app')

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

interface Loaded {
  productId: string
  productName: string
  story: ProductStory
  /** The store's brand stories, or 'failed' when they couldn't be read: never shown as none. */
  blocks: { id: string; name: string }[] | 'failed'
  /** Video's switch and plan; a supplier is told neither, so it reads the switch alone. */
  video: 'on' | 'off' | 'plan'
}

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'notFound' } | ({ kind: 'ready' } & Loaded)

const refusalOf = refusalIn(words.refused)

/** A product's A+ content (CatAPlus, FIRST-RELEASE §11): a draft built from modules, published with the product. */
export const StoryEditor = () => {
  const shell = shellRoute.useLoaderData()
  const { productId = '' } = useParams({ strict: false })
  const forced = useScreenState(storyStates, harnessEnabled)
  const sample = useMemo(() => storySample(forced), [forced])
  const seat = sample ? sample.seat : shell.acting
  const access = editorAccessOf(seat, sample ? sample.readOnly : (shell.state?.readOnly ?? false), false)
  const supplier = seat.seller !== null

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [modules, setModules] = useState<DraftModule[]>([])
  const [saved, setSaved] = useState<DraftModule[]>([])
  const [template, setTemplate] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop')
  const [gaps, setGaps] = useState<StoryGap[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [copying, setCopying] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const show = useCallback((loaded: Loaded) => {
    const draft = modulesOf(loaded.story.modules)
    setModules(draft)
    setSaved(draft)
    setTemplate(loaded.story.template)
    setSelected(draft[0]?.id ?? null)
    setNames(Object.fromEntries(loaded.story.products.map((p) => [p.id, p.name])))
    setGaps([])
    setView({ kind: 'ready', ...loaded })
  }, [])

  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return show(sample.loaded)
    void Promise.all([loadProduct(productId), loadProductStory(productId), supplier ? Promise.resolve([]) : loadStoryBlocks().catch(() => 'failed' as const), loadProductBasics()]).then(
      ([product, story, blocks, basics]) => {
        if (!product || !story) return setView({ kind: 'notFound' })
        const video = basics.features.find((f) => f.key === 'video')
        show({ productId: product.id, productName: product.name, story, blocks, video: !video?.enabled ? 'off' : video.inPlan === false ? 'plan' : 'on' })
      },
      () => setView({ kind: 'error' }),
    )
  }, [forced, sample, show, productId, supplier])

  useEffect(load, [load])

  const dirty = view.kind === 'ready' && !sameModules(modules, saved)
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm(words.leave), enableBeforeUnload: () => dirty })

  if (view.kind === 'loading') return <LoadingState label={words.loading} />
  if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
  if (view.kind === 'notFound')
    return (
      <EmptyState
        title={words.notFound.title}
        body={words.notFound.body}
        action={
          <Link className="df-button" to="/products">
            {words.notFound.back}
          </Link>
        }
      />
    )

  const disabled = !access.canEdit || busy
  const full = modules.length >= maxModules
  const current = modules.find((m) => m.id === selected) ?? null
  const marked = new Set(gaps.map((g) => g.moduleId))
  const status = dirty ? 'unsaved' : view.story.status
  const publishLabel = supplier ? words.submit : words.publish

  const change = (id: string) => (fix: (m: DraftModule) => DraftModule) => {
    setModules((list) => list.map((m) => (m.id === id ? fix(m) : m)))
    setGaps((g) => g.filter((x) => x.moduleId !== id))
  }
  const add = (kind: StoryKind) => {
    if (full) return setToast(fill(words.tooMany, { max: String(maxModules) }))
    if (kind === 'video' && view.video !== 'on') return setToast(view.video === 'off' ? words.videoOff : words.videoPlan)
    const m = blankModule(kind)
    setModules((list) => [...list, m])
    setSelected(m.id)
  }
  const applyTemplate = (key: StoryTemplate) => {
    const apply = () => {
      // A brand story is the store's own: a supplier's template goes without it, as its palette does.
      const made = storyTemplates[key].filter((k) => !(supplier && k === 'brand')).map(blankModule)
      setModules(made)
      setTemplate(key)
      setSelected(made[0]?.id ?? null)
      setToast(fill(words.templateAdded, { name: words.templates[key] }))
    }
    if (modules.length === 0) return apply()
    setAsk({ title: fill(words.templateTitle, { name: words.templates[key] }), target: words.templates[key], consequence: words.templateBody, confirmLabel: words.templateConfirm, onConfirm: apply })
  }

  /** Save the draft (if it changed) and answer the stored story; refusals are said, and answer null. */
  const saveDraft = async (): Promise<ProductStory | null> => {
    if (!dirty && view.story.revision > 0) return view.story
    try {
      const stored = await saveProductStory(view.productId, view.story.revision, modules.map(moduleInput), template)
      setView({ ...view, story: stored })
      const draft = modulesOf(stored.modules)
      setModules(draft)
      setSaved(draft)
      return stored
    } catch (error) {
      setToast(refusalOf(error))
      return null
    }
  }
  const onSave = async () => {
    setBusy(true)
    if (await saveDraft()) setToast(words.saved)
    setBusy(false)
  }
  const onPublish = async () => {
    setBusy(true)
    const stored = await saveDraft()
    if (stored) {
      try {
        const live = await publishProductStory(view.productId, stored.revision)
        setView({ ...view, story: live })
        setGaps([])
        setToast(supplier ? words.submitted : words.published)
      } catch (error) {
        const found = isApiError(error, 'STORY_INCOMPLETE') ? gapsOf(error.details) : []
        if (found.length > 0) {
          setGaps(found)
          setSelected(found[0]?.moduleId ?? null)
        } else setToast(refusalOf(error))
      }
    }
    setBusy(false)
  }
  const copyFrom = (from: { id: string; name: string }) =>
    setAsk({
      title: fill(words.copyTitle, { name: from.name }),
      target: from.name,
      consequence: words.copyBody,
      confirmLabel: words.copyConfirm,
      onConfirm: () =>
        void copyProductStory(from.id, view.productId).then(
          async () => {
            const story = await loadProductStory(view.productId)
            if (story) show({ ...view, story })
            setCopying(false)
            setToast(words.copied)
          },
          (error: unknown) => setToast(refusalOf(error)),
        ),
    })

  return (
    <div className="df-story">
      <div className="df-story-top">
        <Link className="df-story-back" to="/products/$productId" params={{ productId: view.productId }}>
          {fill(words.back, { name: view.productName })}
        </Link>
        <h1>{words.title}</h1>
        <span className={`df-story-state df-story-state--${status}`}>{words.state[status]}</span>
        <span className="df-story-count">{fill(words.count, { count: formatCount(modules.length), max: formatCount(maxModules) })}</span>
        <span className="df-story-gap" />
        <span className="df-story-views" role="radiogroup" aria-label={words.views.label}>
          {(['desktop', 'phone'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={device === v} onClick={() => setDevice(v)}>
              {words.views[v]}
            </button>
          ))}
        </span>
        {access.canEdit && (
          <>
            <button type="button" className="df-button" disabled={busy || !dirty} onClick={() => void onSave()}>
              {busy ? words.saving : words.saveDraft}
            </button>
            <button type="button" className="df-button df-button--primary" disabled={busy || modules.length === 0} onClick={() => void onPublish()}>
              {publishLabel}
            </button>
          </>
        )}
      </div>

      {access.readOnlyStore && <p className="df-story-banner-note">{words.readOnly}</p>}
      {access.viewOnly && <p className="df-story-banner-note">{words.viewOnly}</p>}
      {gaps.length > 0 && (
        <p className="df-story-banner-note df-story-banner-note--warn" role="alert">
          {fill(plural(words.gaps, gaps.length), { count: formatCount(gaps.length) })}
        </p>
      )}

      <div className={current ? 'df-story-layout df-story-layout--panel' : 'df-story-layout'}>
        {access.canEdit && (
          <aside className="df-story-palette" aria-label={words.palette}>
            <h2>{words.palette}</h2>
            {storyKinds.map((k) => (
              <button key={k} type="button" className="df-story-add" disabled={disabled || (k === 'brand' && supplier)} onClick={() => add(k)}>
                <span>{words.kinds[k]}</span>
                {(words.kindTags as Record<string, string>)[k] && <span className="df-story-tag">{(words.kindTags as Record<string, string>)[k]}</span>}
                {k === 'video' && view.video !== 'on' && <span className="df-story-tag">{view.video === 'off' ? words.videoOff : words.videoPlan}</span>}
              </button>
            ))}
            <h2>{words.startFrom}</h2>
            <div className="df-story-row">
              {(Object.keys(storyTemplates) as StoryTemplate[]).map((t) => (
                <button key={t} type="button" className="df-story-chip" disabled={disabled} onClick={() => applyTemplate(t)}>
                  {words.templates[t]}
                </button>
              ))}
            </div>
            {copying ? <ProductSearch label={words.copySearch} hide={[view.productId]} onPick={copyFrom} /> : (
              <button type="button" className="df-story-link" disabled={disabled} onClick={() => setCopying(true)}>
                {words.copyFrom}
              </button>
            )}
          </aside>
        )}
        <StoryCanvas
          modules={modules}
          selected={selected}
          view={device}
          disabled={disabled}
          marked={marked}
          names={names}
          actions={{
            select: setSelected,
            move: (i, by) => setModules((list) => moved(list, i, by)),
            duplicate: (i) => {
              if (full) return setToast(fill(words.tooMany, { max: String(maxModules) }))
              const source = modules[i]
              if (!source) return
              const copy = duplicateModule(source)
              setModules((list) => [...list.slice(0, i + 1), copy, ...list.slice(i + 1)])
              setSelected(copy.id)
            },
            remove: (i) => {
              setModules((list) => list.filter((_, j) => j !== i))
              setSelected(null)
              setToast(words.removed)
            },
          }}
        />
        {current && (
          <StoryPanel
            module={current}
            change={change(current.id)}
            disabled={disabled}
            gaps={gaps.filter((g) => g.moduleId === current.id)}
            productName={view.productName}
            productId={view.productId}
            blocks={view.blocks}
            supplier={supplier}
            names={names}
            onNamed={(p) => setNames((n) => ({ ...n, [p.id]: p.name }))}
          />
        )}
      </div>

      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
