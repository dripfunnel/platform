import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { installApp, loadApps, loadInstallableApp, uninstallApp, type InstalledApp, type InstallableApp } from '../../../api/settingsApps'
import { loadStoreTimeZone } from '../../../api/storeInfo'
import { ApiError, isApiError, type ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { FormSheet } from '../FormSheet'
import { TabFrame } from '../TabFrame'
import { accessOf, appOfLink, metaOf, scopeWords, siteOf, troubleOf } from './appView'

// Settings › Apps (SetDev "apps"; FIRST-RELEASE (store) §15): private apps, each with only the access the Owner approved, opened on their own site.
export function AppsTab() {
  return (
    <TabFrame
      label={t('settings.tabs.apps')}
      load={async (client) => {
        const [apps, timeZone] = await Promise.all([loadApps(client), loadStoreTimeZone(client).catch(() => null)])
        return { apps, timeZone: timeZone ?? 'UTC' }
      }}
    >
      {({ data, client, canEdit, refresh }) => <AppsBody apps={data.apps} timeZone={data.timeZone} client={client} canEdit={canEdit} refresh={refresh} />}
    </TabFrame>
  )
}

type Sheet = { kind: 'link' } | { kind: 'consent'; app: InstallableApp } | { kind: 'remove'; app: InstalledApp }
type Props = { apps: readonly InstalledApp[]; timeZone: string; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }

function AppsBody({ apps, timeZone, client, canEdit, refresh }: Props) {
  const { colors } = useTheme()
  const [sheet, setSheet] = useState<Sheet | null>(null)

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.apps.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.apps.sub')}</Text>
        {canEdit ? <Button saves label={t('settings.apps.add')} onPress={() => setSheet({ kind: 'link' })} /> : null}
      </View>
      <Notice text={t('settings.apps.about')} />
      {apps.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.apps.empty')}</Text> : null}
      {apps.map((app) => {
        const site = siteOf(app.siteUrl)
        const trouble = troubleOf(app)
        return (
          <SectionCard key={app.id} title={app.name} sub={metaOf(app, timeZone)}>
            <Text style={[styles.text, { color: colors.text }]}>{accessOf(app, timeZone)}</Text>
            {trouble ? <Notice text={trouble} /> : null}
            {site ? <Button kind="secondary" label={t('settings.apps.open')} onPress={() => void Linking.openURL(site)} /> : null}
            {canEdit ? <Button saves kind="secondary" label={t('settings.apps.remove')} onPress={() => setSheet({ kind: 'remove', app })} /> : null}
          </SectionCard>
        )
      })}

      {sheet?.kind === 'link' ? <LinkSheet client={client} onClose={() => setSheet(null)} onFound={(app) => setSheet({ kind: 'consent', app })} /> : null}
      {sheet?.kind === 'consent' ? <ConsentSheet app={sheet.app} client={client} onClose={() => setSheet(null)} refresh={refresh} /> : null}
      {sheet?.kind === 'remove' ? (
        <FormSheet
          title={t('settings.apps.removeTitle', { name: sheet.app.name })}
          body={t('settings.apps.removeBody')}
          confirm={t('settings.apps.removeGo')}
          danger
          context="settingsApps"
          onClose={() => setSheet(null)}
          onSubmit={async () => {
            await uninstallApp(client, sheet.app.id)
            await refresh()
            return t('settings.apps.removed', { name: sheet.app.name })
          }}
        />
      ) : null}
    </>
  )
}

function LinkSheet({ client, onClose, onFound }: { client: ApiClient; onClose: () => void; onFound: (app: InstallableApp) => void }) {
  const [link, setLink] = useState('')
  const [tried, setTried] = useState(false)
  const read = appOfLink(link)
  const problem = read.kind === 'notHttps' ? t('settings.apps.notHttps') : null

  return (
    <FormSheet
      title={t('settings.apps.add')}
      body={t('settings.apps.addBody')}
      confirm={t('settings.apps.next')}
      context="settingsApps"
      onClose={onClose}
      check={() => {
        setTried(true)
        return problem
      }}
      onSubmit={async () => {
        const app = read.kind === 'app' ? await loadInstallableApp(client, read.id) : null
        if (!app) throw new ApiError('INVALID_INPUT', 'no app')
        onFound(app)
        return null
      }}
    >
      <TextField label={t('settings.apps.link')} value={link} onChangeText={setLink} placeholder={t('settings.apps.linkPlaceholder')} keyboardType="url" autoComplete="off" invalid={tried && problem !== null} />
    </FormSheet>
  )
}

type ConsentProps = { app: InstallableApp; client: ApiClient; onClose: () => void; refresh: () => Promise<void> }

// The consent screen (SetDev): what the app will and won't be able to do. Install sends back the scopes it showed, and when the app has asked for
// others since (`SCOPES_CHANGED`) the sheet shows what it asks now.
function ConsentSheet({ app: first, client, onClose, refresh }: ConsentProps) {
  const { colors } = useTheme()
  const [app, setApp] = useState(first)

  return (
    <FormSheet
      title={t('settings.apps.installTitle', { name: app.name })}
      body={t('settings.apps.by', { developer: app.developer })}
      confirm={t('settings.apps.install')}
      context="settingsApps"
      onClose={onClose}
      onSubmit={async () => {
        try {
          await installApp(client, app.id, app.scopes)
        } catch (error) {
          if (isApiError(error, 'SCOPES_CHANGED')) {
            const now = await loadInstallableApp(client, app.id).catch(() => null)
            if (now) setApp(now)
          }
          throw error
        }
        await refresh()
        return t('settings.apps.installed', { name: app.name })
      }}
    >
      <Text style={[styles.label, { color: colors.text }]}>{t('settings.apps.can')}</Text>
      {app.scopes.map((scope) => (
        <Text key={scope} style={[styles.text, { color: colors.text }]}>{`• ${scopeWords(scope)}`}</Text>
      ))}
      <Text style={[styles.label, { color: colors.text }]}>{t('settings.apps.cannot')}</Text>
      <Text style={[styles.text, { color: colors.text }]}>{`• ${t('settings.apps.never.change')}`}</Text>
      <Text style={[styles.text, { color: colors.text }]}>{`• ${t('settings.apps.never.secrets')}`}</Text>
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.apps.wholeStore')}</Text>
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 19, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  text: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 14, fontWeight: '700' },
})
