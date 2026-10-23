import { useState } from 'react'
import { copyProductStory, gapsOf, loadProductStory, publishProductStory, saveProductStory, type ProductStory, type StoryGap } from '../../../api/productStory'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useFeedback } from '../../shell/Feedback'
import { useShell } from '../../shell/ShellData'
import { productAccessOf } from '../access'
import type { StoryData } from './loadStory'
import { blankModule, duplicateModule, hasUploading, maxModules, modulesOf, moduleInput, moved, sameModules, storyTemplates, type DraftModule, type StoryKind, type StoryTemplate } from './storyDraft'

// The A+ editor's state and what it does (CatAPlus; CATALOG-DESIGN.md Q): the draft modules, saving the draft, and publishing it
// with the product. What publishing still needs is the API's list of gaps; nothing here decides that a story is complete.
export function useStory(client: ApiClient, data: StoryData) {
  const feedback = useFeedback()
  const { state } = useShell()
  const access = productAccessOf(data.access, state?.readOnly === true, false)
  const [story, setStory] = useState<ProductStory>(data.story)
  const [modules, setModules] = useState<DraftModule[]>(() => modulesOf(data.story.modules))
  const [saved, setSaved] = useState<DraftModule[]>(modules)
  const [template, setTemplate] = useState<string | null>(data.story.template)
  const [gaps, setGaps] = useState<StoryGap[]>([])
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(data.story.products.map((product) => [product.id, product.name])))
  const [open, setOpen] = useState<string | null>(modules[0]?.id ?? null)
  const [busy, setBusy] = useState(false)

  const dirty = !sameModules(modules, saved)
  const canEdit = access.canEdit && !busy
  const supplier = access.side === 'supplier'

  const show = (next: ProductStory) => {
    const draft = modulesOf(next.modules)
    setStory(next)
    setModules(draft)
    setSaved(draft)
    setTemplate(next.template)
    setNames((current) => ({ ...current, ...Object.fromEntries(next.products.map((product) => [product.id, product.name])) }))
  }

  const change = (id: string) => (fix: (module: DraftModule) => DraftModule) => {
    setModules((list) => list.map((module) => (module.id === id ? fix(module) : module)))
    setGaps((current) => current.filter((gap) => gap.moduleId !== id))
  }

  const add = (kind: StoryKind) => {
    if (modules.length >= maxModules) return feedback.toast({ message: t('products.story.tooMany', { max: maxModules }) })
    if (kind === 'video' && data.video !== 'on') return feedback.toast({ message: data.video === 'off' ? t('products.story.videoOff') : t('products.story.videoPlan') })
    const module = blankModule(kind)
    setModules((list) => [...list, module])
    setOpen(module.id)
  }

  const applyTemplate = (key: StoryTemplate) => {
    const apply = () => {
      // A brand story is the store's own: a supplier's template goes without it, as its palette does.
      const made = storyTemplates[key].filter((kind) => !(supplier && kind === 'brand')).map(blankModule)
      setModules(made)
      setTemplate(key)
      setOpen(made[0]?.id ?? null)
      feedback.toast({ message: t('products.story.templateAdded', { name: t(`products.story.templates.${key}`) }) })
    }
    if (modules.length === 0) return apply()
    feedback.sheet({ title: t('products.story.templateTitle', { name: t(`products.story.templates.${key}`) }), body: t('products.story.templateBody'), confirm: t('products.story.templateConfirm'), onConfirm: apply })
  }

  const remove = (module: DraftModule) => {
    const before = modules
    setModules((list) => list.filter((candidate) => candidate.id !== module.id))
    feedback.toast({ message: t('products.story.removed'), undo: () => setModules(before) })
  }

  const move = (module: DraftModule, by: -1 | 1) => setModules((list) => moved(list, list.findIndex((candidate) => candidate.id === module.id), by))

  const duplicate = (module: DraftModule) => {
    if (modules.length >= maxModules) return feedback.toast({ message: t('products.story.tooMany', { max: maxModules }) })
    const copy = duplicateModule(module)
    setModules((list) => {
      const at = list.findIndex((candidate) => candidate.id === module.id)
      return [...list.slice(0, at + 1), copy, ...list.slice(at + 1)]
    })
    setOpen(copy.id)
  }

  const refusal = (error: unknown) => feedback.toast({ message: errorMessage(error, 'products') })

  /** Saves the draft when it changed and answers the stored story, or null when the API refused (said in a toast). */
  const saveDraft = async (): Promise<ProductStory | null> => {
    if (hasUploading(modules)) {
      feedback.toast({ message: t('products.story.waitUpload') })
      return null
    }
    if (!dirty && story.revision > 0) return story
    try {
      const stored = await saveProductStory(client, data.productId, story.revision, modules.map(moduleInput), template)
      show(stored)
      return stored
    } catch (error) {
      refusal(error)
      return null
    }
  }

  const save = async () => {
    setBusy(true)
    if (await saveDraft()) feedback.toast({ message: t('products.story.saved') })
    setBusy(false)
  }

  const publish = async () => {
    setBusy(true)
    const stored = await saveDraft()
    if (stored) {
      try {
        show(await publishProductStory(client, data.productId, stored.revision))
        setGaps([])
        feedback.toast({ message: supplier ? t('products.story.submitted') : t('products.story.published') })
      } catch (error) {
        const found = isApiError(error, 'STORY_INCOMPLETE') ? gapsOf(error.details) : []
        if (found.length > 0) {
          setGaps(found)
          setOpen(found[0]?.moduleId ?? null)
        } else refusal(error)
      }
    }
    setBusy(false)
  }

  const copyFrom = (from: { id: string; name: string }) =>
    feedback.sheet({
      title: t('products.story.copyTitle', { name: from.name }),
      body: t('products.story.copyBody'),
      confirm: t('products.story.copyConfirm'),
      onConfirm: async () => {
        try {
          await copyProductStory(client, from.id, data.productId)
          const next = await loadProductStory(client, data.productId)
          if (next) show(next)
          feedback.toast({ message: t('products.story.copied') })
        } catch (error) {
          refusal(error)
        }
      },
    })

  const addNames = (picked: { id: string; name: string }[]) => setNames((current) => ({ ...current, ...Object.fromEntries(picked.map((product) => [product.id, product.name])) }))

  return { access, story, modules, dirty, canEdit, busy, supplier, gaps, names, addNames, open, setOpen, change, add, applyTemplate, remove, move, duplicate, save, publish, copyFrom, template }
}
