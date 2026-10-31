import { useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native'
import { useBrand } from '../../../brand/BrandProvider'
import { loadDesignChat, askStudio, publishBefore, undoDesignChange } from '../../../api/studio'
import { previewLink } from '../../../api/storefront'
import { partnerDomain } from '../../../graphql'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { useLoad } from '../../common/useLoad'
import { PickerField } from '../../settings/PickerField'
import { FormSheet } from '../../settings/FormSheet'
import { SegmentedControl } from '../../shell/SegmentedControl'
import { useFeedback } from '../../shell/Feedback'
import { useShell } from '../../shell/ShellData'
import { DiscardSheet, PublishSheet } from '../StorefrontSheets'
import { usePublishRun } from '../usePublishRun'
import type { StudioData } from './loadStudio'
import { PublishNotice } from './PublishNotice'
import { StudioChat } from './StudioChat'
import { StudioFrame } from './StudioFrame'
import { nextVersionOf, overlayText, pageOptions } from './studioRules'
import { useStudioSession } from './useStudioSession'

type Props = { client: ApiClient; designClient: ApiClient; data: StudioData; refresh: () => Promise<void> }
type Pane = 'chat' | 'preview'
type Sheet = { kind: 'publish' | 'discard' } | { kind: 'before'; messageId: string }

const statusOf = (status: StudioData['overview']['status']) => (status === 'unpublished_changes' || status === 'same_as_live' ? status : 'not_published')

// The studio at phone width (PortalStorefront › studio): the top bar's facts and actions, and Chat | Preview as two views of one session. Edit text is not on the phone (decided on #513).
export function StudioView({ client, designClient, data, refresh }: Props) {
  const { overview, host, templates, pages } = data
  const { colors } = useTheme()
  const feedback = useFeedback()
  const { acting } = useShell()
  const { brand } = useBrand()
  const { frame, sandbox, reopen, end } = useStudioSession(client, partnerDomain())
  const chat = useLoad(() => loadDesignChat(client), [client])
  const [pane, setPane] = useState<Pane>('chat')
  const [path, setPath] = useState('/')
  const [visit, setVisit] = useState(0)
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [backTo, setBackTo] = useState<number | null>(null)
  const draft = overview.draft !== null
  const messages = chat.state.status === 'ready' ? chat.state.data : []

  // A read that fails leaves the conversation and the facts as they were.
  const reread = async () => {
    try {
      chat.set(await loadDesignChat(client))
    } catch {
      /* the next change or return reads again */
    }
    await refresh()
  }

  const publishing = usePublishRun(client, {
    onLive: (version) => {
      void reread()
      feedback.toast({ message: version === null ? t('storefront.publish.live') : t('storefront.studio.publish.live', { number: version }) })
    },
  })
  const running = publishing.state.phase === 'running'

  const refused = (error: unknown) => {
    if (isApiError(error, 'SESSION_ENDED')) end()
    return errorMessage(error, 'storefront')
  }

  const ask = async (text: string, sampleUrl: string | null): Promise<boolean> => {
    setFailure(null)
    setAsking(true)
    try {
      const outcome = await askStudio(designClient, { text, sampleUrl, page: path })
      await reread()
      if (outcome === 'changed') {
        publishing.dismiss()
        setPane('preview')
      }
      return outcome !== 'failed'
    } catch (error) {
      setFailure(refused(error))
      if (isApiError(error, 'NO_RESPONSE')) await reread()
      return false
    } finally {
      setAsking(false)
    }
  }

  const undo = async (messageId: string) => {
    setFailure(null)
    setUndoing(messageId)
    try {
      await undoDesignChange(client, messageId)
      await reread()
    } catch (error) {
      setFailure(refused(error))
    } finally {
      setUndoing(null)
    }
  }

  // The link is a bearer credential: it goes to the phone's browser and nowhere else (PREVIEW §5).
  const openPreview = async () => {
    setFailure(null)
    try {
      const link = await previewLink(client)
      if (!link.startsWith('https://')) return setFailure(t('storefront.openFailed'))
      await Linking.openURL(link)
    } catch (error) {
      setFailure(isApiError(error) ? refused(error) : t('storefront.openFailed'))
    }
  }

  const closeSheet = () => setSheet(null)
  const culpritId = publishing.state.phase === 'failed' ? (publishing.state.run?.bisectMessageId ?? null) : null
  const culprit = culpritId === null ? null : messages.filter((message) => message.id === culpritId).map((message) => ({ id: message.id, text: message.text }))[0] ?? null
  const templateName = (key: string) => templates.find((template) => template.key === key)?.name ?? key
  const title = t('storefront.studio.title', { template: overview.template ? templateName(overview.template) : t('storefront.overview.custom'), store: acting.storeName })
  const overlay = overlayText(sandbox)
  const options = pageOptions(pages).map((option) => ({ value: option.value, label: option.label, sub: option.group }))
  const picked = options.some((option) => option.value === path) ? path : null

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.heading }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.status, { color: colors.muted }]}>
          {host ? `${t(`storefront.studio.status.${statusOf(overview.status)}`)} · ${host}` : t(`storefront.studio.status.${statusOf(overview.status)}`)}
        </Text>
        {draft ? <Button label={overview.live === null ? t('storefront.studio.publish.firstButton') : t('storefront.studio.publish.button')} disabled={running || asking || sandbox.kind === 'ended'} saves onPress={() => setSheet({ kind: 'publish' })} /> : null}
        {draft ? (
          <View style={styles.row}>
            <View style={styles.half}>
              <Button kind="secondary" label={t('storefront.draft.discard')} disabled={running || asking} saves onPress={() => setSheet({ kind: 'discard' })} />
            </View>
            <View style={styles.half}>
              <Button kind="secondary" label={t('storefront.studio.preview.open')} disabled={overview.draft?.previewReady !== true} saves onPress={() => void openPreview()} />
            </View>
          </View>
        ) : null}
      </View>
      <SegmentedControl
        segments={[
          { key: 'chat', label: t('storefront.studio.panes.chat') },
          { key: 'preview', label: t('storefront.studio.panes.preview') },
        ]}
        value={pane}
        onChange={setPane}
      />
      {asking ? (
        <View accessibilityLiveRegion="polite" style={styles.busy}>
          <ActivityIndicator color={colors.brand} />
          <Text style={[styles.busyText, { color: colors.textStrong }]}>{t('storefront.studio.sandbox.checking')}</Text>
        </View>
      ) : null}
      <View style={styles.body}>
        <View style={[styles.pane, pane === 'chat' ? null : styles.hidden]}>
          <StudioChat
            messages={messages}
            loading={chat.state.status === 'loading'}
            loadFailed={chat.state.status === 'error'}
            assistant={brand?.productName ? t('storefront.studio.chat.assistant', { brand: brand.productName }) : t('storefront.studio.chat.assistantPlain')}
            templateName={templateName}
            disabled={asking || running || sandbox.kind !== 'ready'}
            asking={asking}
            failure={failure}
            undoing={undoing}
            onAsk={ask}
            onUndo={(id) => void undo(id)}
          >
            <PublishNotice publishing={publishing.state} next={nextVersionOf(overview)} backTo={backTo} culprit={culprit} onBefore={(messageId) => setSheet({ kind: 'before', messageId })} onCheckAgain={publishing.checkAgain} />
          </StudioChat>
        </View>
        <View style={[styles.pane, pane === 'preview' ? null : styles.hidden]}>
          <View style={styles.picker}>
            <PickerField
              label={t('storefront.studio.page')}
              value={picked ?? ''}
              placeholder={path}
              options={options}
              onChange={(value) => {
                setPath(value)
                setVisit((n) => n + 1)
              }}
            />
          </View>
          <View style={styles.frame}>
            {frame ? <StudioFrame key={`${frame.id}-${visit}`} frame={frame} path={path} /> : null}
            {overlay ? (
              <View style={[styles.overlay, { backgroundColor: colors.surface }]}>
                {sandbox.kind !== 'ended' && sandbox.kind !== 'failed' ? <ActivityIndicator color={colors.brand} /> : null}
                <Text accessibilityLiveRegion="polite" style={[styles.overlayText, { color: colors.textStrong }]}>
                  {overlay}
                </Text>
                {sandbox.kind === 'ended' || sandbox.kind === 'failed' ? <Button label={t('storefront.studio.sandbox.reopen')} onPress={reopen} /> : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>
      {sheet?.kind === 'publish' ? (
        <PublishSheet
          client={client}
          onClose={closeSheet}
          next={nextVersionOf(overview)}
          back={(overview.live?.number ?? null)}
          host={host}
          onStarted={(id) => {
            setBackTo((overview.live?.number ?? null))
            publishing.follow(id)
          }}
        />
      ) : null}
      {sheet?.kind === 'discard' ? (
        <DiscardSheet
          client={client}
          onClose={closeSheet}
          onDone={async () => {
            publishing.dismiss()
            await reread()
            setVisit((n) => n + 1)
          }}
        />
      ) : null}
      {sheet?.kind === 'before' ? (
        <BeforeSheet
          client={client}
          messageId={sheet.messageId}
          onClose={closeSheet}
          onStarted={(id) => {
            setBackTo((overview.live?.number ?? null))
            publishing.follow(id)
          }}
        />
      ) : null}
    </View>
  )
}

function BeforeSheet({ client, messageId, onClose, onStarted }: { client: ApiClient; messageId: string; onClose: () => void; onStarted: (id: string) => void }) {
  return (
    <FormSheet
      title={t('storefront.studio.publish.before')}
      body={t('storefront.studio.publish.beforeBody')}
      confirm={t('storefront.studio.publish.beforeConfirm')}
      context="storefront"
      onClose={onClose}
      onSubmit={async () => {
        onStarted(await publishBefore(client, messageId))
        return t('storefront.publish.started')
      }}
    />
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { padding: 14, gap: 10, borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: '800' },
  status: { fontSize: 13 },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 6 },
  busyText: { fontSize: 14, fontWeight: '600' },
  body: { flex: 1 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  picker: { padding: 12 },
  frame: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  overlayText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
})
