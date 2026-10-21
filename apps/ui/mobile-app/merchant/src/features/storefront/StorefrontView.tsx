import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { askDesign, goBackToVersion, previewLink, requestLimit } from '../../api/storefront'
import { isApiError, type ApiClient } from '../../graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { useTheme } from '../../theme'
import { Notice } from '../common/Notice'
import { openPortal } from '../settings/portalLink'
import { useFeedback } from '../shell/Feedback'
import type { StorefrontAccess } from './access'
import { BestOnWebSheet } from './BestOnWebSheet'
import { ChangeCard } from './ChangeCard'
import { DraftCard } from './DraftCard'
import { LiveCard } from './LiveCard'
import type { StorefrontData } from './loadPage'
import { DiscardSheet, PublishSheet, RestoreSheet } from './StorefrontSheets'
import { lastPublishOf, liveNumber, nextVersion, recentVersions, siteOf, storefrontPortalPath, versionLabel } from './siteView'
import { usePublishRun } from './usePublishRun'
import { VersionsCard } from './VersionsCard'

type Props = { client: ApiClient; designClient: ApiClient; access: StorefrontAccess; data: StorefrontData; refresh: () => Promise<void> }
type Sheet = { kind: 'publish' | 'discard' | 'web' } | { kind: 'restore'; version: Parameters<typeof RestoreSheet>[0]['version'] }
type Message = { kind: 'info' | 'error'; text: string }

// The compact Storefront screen (`sfApp`). A write by anyone but the Owner is refused by the API; this screen simply doesn't offer one to a seat that can't.
export function StorefrontView({ client, designClient, access, data, refresh }: Props) {
  const { overview, host, request, timeZone } = data
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [making, setMaking] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [before, setBefore] = useState<number | null>(null)
  const site = siteOf(overview.status)
  const live = overview.live !== null
  const closeSheet = () => setSheet(null)

  const undo = async (back: number) => {
    try {
      await goBackToVersion(client, back)
      feedback.toast({ message: t('storefront.versions.undone', { number: back }) })
    } catch (error) {
      feedback.toast({ message: errorMessage(error, 'storefront') })
    }
    await refresh()
  }

  const publishing = usePublishRun(client, {
    onLive: () => {
      void refresh()
      feedback.toast({ message: t('storefront.publish.live'), ...(before !== null ? { undo: () => void undo(before) } : {}) })
    },
  })

  // The address is opened by the system browser. A preview link is a bearer credential: it goes to the browser and nowhere else (PREVIEW.md §5).
  const preview = async () => {
    setMessage(null)
    if (overview.draft?.previewReady !== true) return setMessage({ kind: 'info', text: t('storefront.draft.previewWaiting') })
    try {
      const link = await previewLink(client)
      if (!link.startsWith('https://')) return setMessage({ kind: 'error', text: t('storefront.openFailed') })
      await Linking.openURL(link)
    } catch (error) {
      setMessage({ kind: 'error', text: isApiError(error) ? errorMessage(error, 'storefront') : t('storefront.openFailed') })
    }
  }

  const openShop = () => void Linking.openURL(`https://${host}`).catch(() => setMessage({ kind: 'error', text: t('storefront.openFailed') }))
  const openWeb = () => void openPortal(storefrontPortalPath).catch(() => setMessage({ kind: 'error', text: t('storefront.openFailed') }))

  const make = async () => {
    const asked = prompt.trim()
    if (asked === '') return setMessage({ kind: 'error', text: t('storefront.change.empty') })
    if (asked.length > requestLimit) return setMessage({ kind: 'error', text: t('storefront.change.tooLong', { max: requestLimit }) })
    setMessage(null)
    setMaking(true)
    try {
      const answer = await askDesign(designClient, asked)
      if (answer.outcome === 'changed') {
        setPrompt('')
        publishing.dismiss()
        await refresh()
        feedback.toast({ message: t('storefront.change.ready') })
      } else if (answer.outcome === 'unchanged') {
        setMessage({ kind: 'info', text: answer.reply ? t('storefront.change.unchanged', { reply: answer.reply }) : t('storefront.change.unchangedBare') })
      } else setMessage({ kind: 'error', text: t('storefront.change.failed') })
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error, 'storefront') })
      if (isApiError(error, 'NO_RESPONSE')) await refresh()
    } finally {
      setMaking(false)
    }
  }

  const startPublish = (id: string) => {
    setBefore(liveNumber(overview))
    publishing.follow(id)
  }

  return (
    <View style={styles.content}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('storefront.title')}
      </Text>
      {site === 'none' ? <Notice text={`${t('storefront.noSite.title')}. ${overview.status === 'create_failed' ? t('storefront.createFailed') : t('storefront.noSite.body')}`} /> : null}
      {site === 'creating' ? <Notice text={t('storefront.creating')} /> : null}
      {site === 'ready' ? (
        <>
          <LiveCard
            host={host}
            live={live}
            lastChange={overview.history[0] ? t('storefront.lastChange', { label: versionLabel(overview.history[0]) }) : null}
            onView={openShop}
          />
          {access.viewOnly ? <Notice text={t('storefront.viewOnly')} /> : null}
          {access.readOnly ? <Notice text={t('storefront.readOnly')} /> : null}
          {message ? <Notice kind={message.kind === 'error' ? 'error' : 'info'} text={message.text} /> : null}
          {access.canEdit && overview.draft === null ? <ChangeCard prompt={prompt} onPrompt={setPrompt} making={making} onMake={() => void make()} /> : null}
          {access.canEdit && overview.draft !== null ? (
            <DraftCard
              request={request}
              publishing={publishing.state}
              next={nextVersion(overview)}
              lastPublish={lastPublishOf(overview)}
              backTo={before}
              onPreview={() => void preview()}
              onDiscard={() => setSheet({ kind: 'discard' })}
              onPublish={() => setSheet({ kind: 'publish' })}
              onCheckAgain={publishing.checkAgain}
            />
          ) : null}
          {overview.history.length > 0 ? <VersionsCard versions={recentVersions(overview.history)} timeZone={timeZone} canRestore={access.canEdit} onRestore={(version) => setSheet({ kind: 'restore', version })} /> : null}
        </>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('storefront.web.label')}
        accessibilityHint={t('storefront.web.sub')}
        onPress={() => setSheet({ kind: 'web' })}
        style={[styles.web, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
      >
        <View style={styles.webText}>
          <Text style={[styles.webLabel, { color: colors.heading }]}>{t('storefront.web.label')}</Text>
          <Text style={[styles.webSub, { color: colors.muted }]}>{t('storefront.web.sub')}</Text>
        </View>
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.chevron, { color: colors.muted }]}>
          ›
        </Text>
      </Pressable>
      {sheet?.kind === 'publish' ? (
        <PublishSheet client={client} onClose={closeSheet} next={nextVersion(overview)} back={liveNumber(overview)} host={host} onStarted={startPublish} />
      ) : null}
      {sheet?.kind === 'discard' ? <DiscardSheet
          client={client}
          onClose={closeSheet}
          onDone={async () => {
            publishing.dismiss()
            await refresh()
          }}
        /> : null}
      {sheet?.kind === 'restore' ? <RestoreSheet client={client} onClose={closeSheet} version={sheet.version} onDone={refresh} /> : null}
      {sheet?.kind === 'web' ? <BestOnWebSheet onClose={closeSheet} onOpenWeb={openWeb} onOpenHere={() => router.push('/more/storefront/designer' as never)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 20 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  web: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 14, borderWidth: 1 },
  webText: { flex: 1, gap: 1 },
  webLabel: { fontSize: 15, fontWeight: '600' },
  webSub: { fontSize: 12 },
  chevron: { fontSize: 22 },
})
