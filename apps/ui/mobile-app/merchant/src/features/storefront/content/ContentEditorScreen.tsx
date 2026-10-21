import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadProductNames } from '../../../api/offers'
import { loadAccess } from '../../../api/products'
import { contentLimits, deleteContent, loadContentEntry, saveContent, type ContentEntry, type ContentKind } from '../../../api/storefrontContent'
import { isApiError, type ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { sessionClient } from '../../../session'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextArea } from '../../common/TextArea'
import { TextField } from '../../common/TextField'
import { useLeaveGuard } from '../../collections/useLeaveGuard'
import { useLoad } from '../../common/useLoad'
import { loadStateOf } from '../../orders/loadState'
import { FormSheet } from '../../settings/FormSheet'
import { useFeedback } from '../../shell/Feedback'
import { useShell } from '../../shell/ShellData'
import { ShellScreen } from '../../states/ShellScreen'
import { Skeleton } from '../../states/StateView'
import { storefrontAccessOf } from '../access'
import { BlocksEditor } from './BlocksEditor'
import { cleanSlug, draftOf, draftProblem, inputOf, isDraftDirty, pathOf, pathTakenText, slugShown, type ContentDraft, type DraftBlock } from './contentDraft'

export type EditorProps = { kind: ContentKind; id: string }

const load = async (client: ApiClient, readOnly: boolean, id: string) => {
  const access = storefrontAccessOf(await loadAccess(client), readOnly)
  if (!access.canRead) return { access, entry: null, names: {} as Record<string, string | null>, namesFailed: false }
  const entry = id === 'new' ? null : await loadContentEntry(client, id)
  if (id !== 'new' && entry === null) throw Object.assign(new Error('missing'), { notFound: true })
  const ids = [...new Set((entry?.body ?? []).flatMap((block) => block.productIds ?? []))]
  // A product the API did not find is gone from the catalogue; when the names could not be read at all, each stays unknown.
  const found = ids.length === 0 ? new Map<string, string | null>() : await loadProductNames(client, ids).catch(() => null)
  return { access, entry, names: found === null ? {} : Object.fromEntries(ids.map((product) => [product, found.get(product) ?? null])), namesFailed: found === null }
}

// One page or post (StorefrontContent's editor at phone width), on its own screen with the shell's Back. A page or post saves as a draft or published; either goes live
// with the shop's next publish, and a save keeps the fields the phone draws no control for.
export function ContentEditorScreen({ kind, id }: EditorProps) {
  const client = sessionClient()
  const { state, online } = useShell()
  const readOnly = state?.readOnly === true
  const label = t(kind === 'page' ? 'storefront.content.pages.title' : 'storefront.content.journal.title')
  const loaded = useLoad(() => load(client, readOnly, id), [client, readOnly, id])

  if (loaded.state.status === 'error') {
    const notFound = (loaded.state.error as { notFound?: boolean }).notFound === true
    return (
      <ShellScreen label={label} state={notFound ? 'notFound' : loadStateOf(loaded.state.error, online)} onRetry={loaded.reload}>
        {null}
      </ShellScreen>
    )
  }
  if (loaded.state.status === 'loading') {
    return (
      <ShellScreen label={label}>
        <Skeleton />
      </ShellScreen>
    )
  }
  const { access, entry, names, namesFailed } = loaded.state.data
  if (!access.canRead) {
    return (
      <ShellScreen label={label} state="denied">
        {null}
      </ShellScreen>
    )
  }
  return (
    <ShellScreen label={label}>
      <ContentEditor client={client} kind={kind} entry={entry} names={names} namesFailed={namesFailed} canEdit={access.canEdit} viewOnly={access.viewOnly} readOnly={access.readOnly} />
    </ShellScreen>
  )
}

type Props = { client: ApiClient; kind: ContentKind; entry: ContentEntry | null; names: Record<string, string | null>; namesFailed: boolean; canEdit: boolean; viewOnly: boolean; readOnly: boolean }

function ContentEditor({ client, kind, entry, names: known, namesFailed, canEdit, viewOnly, readOnly }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const feedback = useFeedback()
  const words = kind === 'page' ? 'pages' : 'journal'
  const [saved, setSaved] = useState(() => draftOf(entry, kind))
  const [draft, setDraft] = useState<ContentDraft>(saved)
  const [current, setCurrent] = useState<{ id: string | null; revision: number | null; status: ContentEntry['status'] | null }>({ id: entry?.id ?? null, revision: entry?.revision ?? null, status: entry?.status ?? null })
  const [names, setNames] = useState(known)
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null)
  const [problem, setProblem] = useState<{ field: string | null; text: string } | null>(null)
  const [asking, setAsking] = useState(false)
  const dirty = isDraftDirty(draft, saved)
  const guard = useLeaveGuard(dirty)
  const edit = canEdit
  const set = (patch: Partial<ContentDraft>) => {
    setDraft((now) => ({ ...now, ...patch }))
    setProblem(null)
  }
  const setBody = useCallback((change: (was: DraftBlock[]) => DraftBlock[]) => setDraft((now) => ({ ...now, body: change(now.body) })), [])

  useEffect(() => {
    setNames(known)
  }, [known])

  const save = async (publish: boolean) => {
    const wrong = draftProblem(draft)
    if (wrong) return setProblem(wrong)
    setBusy(publish ? 'publish' : 'draft')
    setProblem(null)
    try {
      const answer = await saveContent(client, kind, current.id, current.revision, inputOf(kind, draft, publish))
      const next = draftOf(answer, kind)
      setSaved(next)
      setDraft(next)
      setCurrent({ id: answer.id, revision: answer.revision, status: answer.status })
      feedback.toast({ message: t(publish ? 'storefront.content.editor.published' : 'storefront.content.editor.savedDraft') })
    } catch (error) {
      setProblem(refusalOf(error))
    } finally {
      setBusy(null)
    }
  }

  const remove = current.id
  const publishLabel = current.status === 'published' ? t('storefront.content.editor.update') : t('storefront.content.editor.publish')
  const mark = (field: string) => (problem?.field === field ? problem.text : undefined)

  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {draft.title.trim() || t(kind === 'page' ? 'storefront.content.pages.untitled' : 'storefront.content.journal.untitled')}
      </Text>
      {viewOnly ? <Notice text={t('storefront.notice.manager')} /> : null}
      {readOnly ? <Notice text={t('storefront.readOnly')} /> : null}
      {problem && problem.field === null ? <Notice kind="error" text={problem.text} /> : null}
      <SectionCard title={t(`storefront.content.${words}.body`)}>
        <TextField label={t('storefront.content.editor.title')} value={draft.title} onChangeText={(title) => set({ title })} editable={edit} maxLength={contentLimits.title} autoCapitalize="sentences" invalid={mark('title') !== undefined} help={mark('title')} />
        <TextField label={t('storefront.content.editor.slug')} value={draft.slug} onChangeText={(slug) => set({ slug: cleanSlug(slug) })} editable={edit} maxLength={contentLimits.slug} invalid={mark('slug') !== undefined} help={mark('slug') ?? pathOf(kind, slugShown(draft))} />
      </SectionCard>
      <BlocksEditor client={client} kind={kind} body={draft.body} onBody={setBody} canEdit={edit} names={names} namesFailed={namesFailed} onName={(productId, name) => setNames((now) => ({ ...now, [productId]: name }))} />
      <SectionCard title={t('storefront.content.editor.search')}>
        <TextField label={t('storefront.content.editor.seoTitle')} value={draft.seoTitle} onChangeText={(seoTitle) => set({ seoTitle })} editable={edit} autoCapitalize="sentences" invalid={mark('seo') !== undefined} help={mark('seo') ?? t('storefront.content.editor.seoTitleHelp')} />
        <TextArea label={t('storefront.content.editor.seoDescription')} value={draft.seoDescription} onChangeText={(seoDescription) => set({ seoDescription })} editable={edit} placeholder={t('storefront.content.editor.seoPlaceholder')} lines={3} />
      </SectionCard>
      <SectionCard title={t('storefront.content.editor.publishing')} sub={current.status ? t('storefront.content.editor.now', { status: t(`storefront.content.status.${current.status}`) }) : undefined}>
        {kind === 'page' ? <Switch label={t('storefront.content.editor.inMenu')} value={draft.inMenu} onChange={(inMenu) => set({ inMenu })} disabled={!edit} /> : null}
        <Text style={[styles.note, { color: colors.muted }]}>{t('storefront.content.editor.note')}</Text>
        {edit ? (
          <>
            <Button label={busy === 'publish' ? t('storefront.content.editor.saving') : publishLabel} busy={busy === 'publish'} disabled={busy !== null} saves onPress={() => void save(true)} />
            <Button kind="secondary" label={busy === 'draft' ? t('storefront.content.editor.saving') : t('storefront.content.editor.draft')} busy={busy === 'draft'} disabled={busy !== null} saves onPress={() => void save(false)} />
          </>
        ) : null}
      </SectionCard>
      {edit && remove ? <Button kind="secondary" label={t(`storefront.content.${words}.delete`)} saves onPress={() => setAsking(true)} /> : null}
      {asking && remove ? (
        <FormSheet
          title={t(kind === 'page' ? 'storefront.content.pages.deleteTitle' : 'storefront.content.journal.deleteTitle', { title: saved.title })}
          body={kind === 'page' ? t(draft.inMenu ? 'storefront.content.pages.deleteBodyMenu' : 'storefront.content.pages.deleteBody') : t('storefront.content.journal.deleteBody')}
          confirm={t(`storefront.content.${words}.delete`)}
          danger
          context="storefrontContent"
          onClose={() => setAsking(false)}
          onSubmit={async () => {
            await deleteContent(client, kind, remove)
            guard.go(() => router.back())
            return t('storefront.content.editor.deleted')
          }}
        />
      ) : null}
    </View>
  )
}

const refusalOf = (error: unknown): { field: string | null; text: string } => {
  if (!isApiError(error)) return { field: null, text: t('storefront.content.editor.refused.other') }
  if (error.code === 'PATH_TAKEN') return { field: 'slug', text: pathTakenText(String(error.details['path'] ?? ''), String(error.details['heldBy'] ?? '')) }
  if (error.code === 'INVALID_INPUT' && error.details['field'] === 'slug') return { field: 'slug', text: t('storefront.content.editor.needsSlug') }
  const known = ['INVALID_INPUT', 'STALE_REVISION', 'NOT_FOUND', 'READ_ONLY', 'SUPPORT_READ_ONLY', 'FORBIDDEN', 'PLAN_LIMIT'] as const
  const code = known.find((candidate) => candidate === error.code)
  return { field: null, text: code ? t(`storefront.content.editor.refused.${code}`) : t('storefront.content.editor.refused.other') }
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32, gap: 16 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  note: { fontSize: 13, lineHeight: 19 },
})
