import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { loadAccess } from '../../api/products'
import { t } from '../../messages'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Notice } from '../common/Notice'
import { productsHref } from '../products/routes'
import { stateOfError, useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { importAccessOf } from './access'
import { ExportCard } from './ExportCard'
import { ImportCheck } from './ImportCheck'
import { ImportDone, ImportRunning, ImportStopped } from './ImportProgress'
import { ImportStart } from './ImportStart'
import { ImportSteps } from './ImportSteps'
import { ShopifyPicker } from './ShopifyPicker'
import { useImportFlow } from './useImportFlow'

const stepIndex = { start: 0, pick: 0, check: 1, running: 2, done: 3 } as const

// Products › Import & export, and a supplier's own (FIRST-RELEASE.md §13; CatImport at phone width): Choose → Check → Import → Done,
// then Export. The API decides what each seat may import and which rows it exports; nothing here narrows the file.
export function ImportScreen() {
  const { colors } = useTheme()
  const router = useRouter()
  const { seat, state } = useShell()
  const client = sessionClient()
  const access = useLoad(() => loadAccess(client), [client])
  const permissions = access.state.status === 'ready' ? access.state.data : null
  const { canImport, canExport } = permissions ? importAccessOf(permissions, seat) : { canImport: false, canExport: false }
  const supplier = permissions?.supplier ?? seat?.side === 'supplier'
  const flow = useImportFlow(client, supplier, canImport)
  const readOnly = state?.readOnly === true
  const toProducts = () => router.navigate(productsHref(seat) as never)

  if (access.state.status === 'error') {
    return (
      <ShellScreen label={t('imports.title')} state={stateOfError(access.state.error)} onRetry={access.reload}>
        {null}
      </ShellScreen>
    )
  }
  if (permissions && !canImport && !canExport) {
    return (
      <ShellScreen label={t('imports.title')} state="denied">
        {null}
      </ShellScreen>
    )
  }

  const { run } = flow
  return (
    <ShellScreen label={t('imports.title')}>
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {canImport || permissions === null ? t('imports.title') : t('imports.titleExport')}
          </Text>
          {canImport ? <Text style={[styles.lede, { color: colors.muted }]}>{t('imports.lede')}</Text> : null}
        </View>

        {permissions === null ? <Skeleton /> : null}
        {canImport && readOnly ? <Notice text={t('imports.readOnly')} /> : null}
        {canImport ? <ImportSteps current={stepIndex[flow.step]} /> : null}

        {canImport && flow.step === 'start' ? (
          <ImportStart
            client={client}
            mode={flow.mode}
            readOnly={readOnly}
            checking={flow.checking}
            fileError={flow.fileError}
            refusal={flow.refusal}
            onChoose={() => void flow.chooseFile()}
            onShopify={() => flow.setMode('shopify')}
            onConnected={flow.setPicking}
          />
        ) : null}
        {canImport && flow.step === 'pick' && flow.picking ? (
          <ShopifyPicker client={client} shop={flow.picking} checking={flow.checking} onBack={flow.restart} onCheck={(ids) => void flow.checkShop(ids, flow.picking ?? '')} />
        ) : null}
        {canImport && flow.step === 'check' && flow.job ? (
          <ImportCheck job={flow.job} name={flow.fileName} readOnly={readOnly} places={flow.places} onRestart={flow.restart} onRun={flow.confirm} />
        ) : null}
        {canImport && flow.step === 'running' && run ? <ImportRunning run={run} onLeave={toProducts} /> : null}
        {canImport && flow.step === 'done' && run ? run.state === 'done' ? <ImportDone run={run} onRestart={flow.restart} onView={toProducts} /> : <ImportStopped run={run} onRestart={flow.restart} /> : null}

        {canExport ? <ExportCard client={client} /> : null}
      </View>
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  lede: { fontSize: 14, lineHeight: 20 },
})
