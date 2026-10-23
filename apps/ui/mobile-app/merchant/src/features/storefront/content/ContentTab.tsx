import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { loadContentList, loadCustomPaths, type ContentKind, type ContentRow } from '../../../api/storefrontContent'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { formatDay } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useReloadOnFocus } from '../../collections/useReloadOnFocus'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { useLoad } from '../../common/useLoad'
import { Skeleton } from '../../states/StateView'

type Props = { client: ApiClient; kind: ContentKind; canEdit: boolean; onOpenStudio: (path: string) => void }

const metaOf = (row: ContentRow): string => {
  const status = row.status === 'scheduled' && row.publishAt ? t('storefront.content.journal.goesLive', { date: formatDay(row.publishAt, locale, 'UTC') }) : t(`storefront.content.status.${row.status}`)
  const meta = `${status} · ${row.path}`
  return row.inMenu ? t('storefront.content.pages.inMenu', { meta }) : meta
}

// Pages (content pages and the pages the AI made) and Journal (posts): the list, newest first, with the editor on its own screen (StorefrontContent; FIRST-RELEASE (store) §14).
export function ContentTab({ client, kind, canEdit, onOpenStudio }: Props) {
  const { colors, radii } = useTheme()
  const router = useRouter()
  const words = kind === 'page' ? 'pages' : 'journal'
  const loaded = useLoad(async () => {
    const [list, custom] = await Promise.all([loadContentList(client, kind, null), kind === 'page' ? loadCustomPaths(client).catch(() => []) : Promise.resolve([])])
    return { ...list, custom }
  }, [client, kind])
  useReloadOnFocus(loaded.reload)
  const [more, setMore] = useState<{ base: unknown; rows: ContentRow[]; next: string | null } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)

  if (loaded.state.status === 'loading') return <Skeleton />
  if (loaded.state.status === 'error') {
    const planLimit = isApiError(loaded.state.error, 'PLAN_LIMIT')
    return (
      <View style={styles.page}>
        <Notice kind={planLimit ? 'info' : 'error'} text={planLimit ? t('storefront.content.journal.planLimit') : errorMessage(loaded.state.error)} />
        {planLimit ? null : <Button kind="secondary" label={t('storefront.content.error.retry')} onPress={loaded.reload} />}
      </View>
    )
  }
  const data = loaded.state.data
  const extra = more !== null && more.base === data ? more : null
  const rows = [...data.rows, ...(extra?.rows ?? [])]
  const next = extra ? extra.next : data.next

  const showMore = async () => {
    if (next === null) return
    setLoadingMore(true)
    setMoreFailed(false)
    try {
      const page = await loadContentList(client, kind, next)
      setMore({ base: data, rows: [...(extra?.rows ?? []), ...page.rows], next: page.next })
    } catch {
      setMoreFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <View style={styles.page}>
      <Text style={[styles.sub, { color: colors.textStrong }]}>{t(`storefront.content.${words}.sub`)}</Text>
      {canEdit ? <Button label={t(`storefront.content.${words}.add`)} onPress={() => router.push(`/more/storefront/${kind}/new` as never)} /> : null}
      {rows.length === 0 && data.custom.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t(`storefront.content.${words}.empty`)}</Text> : null}
      {rows.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          accessibilityLabel={row.title}
          onPress={() => router.push(`/more/storefront/${kind}/${row.id}` as never)}
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
        >
          <Text style={[styles.title, { color: colors.heading }]}>{row.title}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{metaOf(row)}</Text>
          {row.waitingForPublish ? <Text style={[styles.meta, { color: colors.info }]}>{t('storefront.content.editor.waiting')}</Text> : null}
        </Pressable>
      ))}
      {data.custom.map((path) => (
        <View key={path} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          <Text style={[styles.title, { color: colors.heading }]}>{path}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{`${t('storefront.content.pages.ai')} · ${t('storefront.content.pages.aiMeta')}`}</Text>
          {canEdit ? <Button kind="secondary" label={t('storefront.content.pages.aiOpen', { path })} onPress={() => onOpenStudio(path)} /> : null}
        </View>
      ))}
      {moreFailed ? <Notice kind="error" text={t('storefront.content.moreFailed')} /> : null}
      {next !== null ? <Button kind="secondary" label={t('storefront.content.more')} busy={loadingMore} onPress={() => void showMore()} /> : null}
      <Text style={[styles.meta, { color: colors.muted }]}>{t(`storefront.content.${words}.foot`)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  sub: { fontSize: 14, lineHeight: 21 },
  row: { borderWidth: 1, padding: 14, gap: 4 },
  title: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 19 },
})
