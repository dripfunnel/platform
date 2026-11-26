import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { isApiError } from '../../api/client'
import { collectionsOf, demoMakers, previewRefusals, templatePreviewLink, type StorefrontTemplate } from '../../api/templates'
import { fill, messages } from '../../messages'
import { Toast, useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { TemplateCollections, TemplateCollectionView, TemplatesError } from './Templates'
import { templatesStates } from './templatesHarness'

const listRoute = getRouteApi('/_app/templates')
const collectionRoute = getRouteApi('/_app/templates_/$collection')
const appRoute = getRouteApi('/_app')
const words = messages.templates

export const previewRefusalText = (failure: unknown): string =>
  isApiError(failure) && (previewRefusals as readonly string[]).includes(failure.code) ? words.refusals[failure.code as (typeof previewRefusals)[number]] : words.refusals.other

// The tab opens before the link is made, so the browser doesn't treat it as a pop-up; it closes when there is no link.
const useTemplatePreview = () => {
  const { me } = appRoute.useLoaderData()
  const router = useRouter()
  const [opening, setOpening] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const onPreview = (template: StorefrontTemplate) => {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    setOpening(template.key)
    templatePreviewLink(template.key)
      .then(({ url }) => {
        if (url) {
          if (tab) tab.location.href = url
          else window.location.assign(url)
          return
        }
        tab?.close()
        setToast(fill(words.settingUp, { name: template.name }))
        void router.invalidate()
      })
      .catch((failure: unknown) => {
        tab?.close()
        setToast(previewRefusalText(failure))
      })
      .finally(() => setOpening(null))
  }

  return { cards: { canMake: demoMakers.includes(me.role), opening, onPreview }, toast: <Toast message={toast} onDone={clearToast} /> }
}

export const TemplatesScreen = () => {
  const { templates, categories } = listRoute.useLoaderData()
  const { category } = listRoute.useSearch()
  const navigate = listRoute.useNavigate()
  const forced = useScreenState(templatesStates, harnessEnabled)
  const router = useRouter()
  const { cards, toast } = useTemplatePreview()
  return (
    <>
      <TemplateCollections
        templates={templates}
        categories={categories}
        category={category}
        forced={forced}
        {...cards}
        onCategory={(next) => void navigate({ search: (prev) => ({ ...prev, category: next }), replace: true })}
        onReload={() => void router.invalidate()}
      />
      {toast}
    </>
  )
}

export const TemplateCollectionScreen = () => {
  const templates = collectionRoute.useLoaderData()
  const { collection: key } = collectionRoute.useParams()
  const forced = useScreenState(templatesStates, harnessEnabled)
  const router = useRouter()
  const { cards, toast } = useTemplatePreview()
  return (
    <>
      <TemplateCollectionView collection={collectionsOf(templates).find((c) => c.key === key) ?? null} forced={forced} {...cards} onReload={() => void router.invalidate()} />
      {toast}
    </>
  )
}

export const TemplatesRouteError = () => {
  const router = useRouter()
  return <TemplatesError onRetry={() => void router.invalidate()} />
}
