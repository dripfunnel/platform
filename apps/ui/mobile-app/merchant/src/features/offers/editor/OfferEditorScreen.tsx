import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { offerKinds, type OfferKind } from '../../../api/offers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../../messages'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { stateOfError, useLoad } from '../../common/useLoad'
import { ShellScreen } from '../../states/ShellScreen'
import { Skeleton } from '../../states/StateView'
import type { OffersAccess } from '../access'
import { OffersGate } from '../OffersGate'
import { offersHref } from '../routes'
import { loadOfferEditor } from './loadEditor'
import { OfferForm } from './OfferForm'

const kindOf = (value: string | undefined): OfferKind | null => offerKinds.find((kind) => kind === value) ?? null

function Loader({ client, access, id, type }: { client: ApiClient; access: OffersAccess; id: string | null; type: OfferKind | null }) {
  const { state, reload } = useLoad(() => loadOfferEditor(client, id), [client, id])
  if (state.status === 'ready') return <OfferForm client={client} data={state.data} access={access} initialKind={type} onReload={reload} />
  return (
    <ShellScreen label={t('offers.screen')} onRetry={reload} {...(state.status === 'error' ? { state: stateOfError(state.error) } : {})}>
      <Skeleton />
    </ShellScreen>
  )
}

/** Staff read offers but can't change them: told so, with the way back, before the form's reads are made. */
function NoEditing() {
  const router = useRouter()
  return (
    <ShellScreen label={t('offers.screen')}>
      <View style={styles.box}>
        <Notice text={`${t('offers.editor.staff.title')}. ${t('offers.editor.staff.body')}`} />
        <Button kind="secondary" label={t('offers.editor.staff.back')} onPress={() => router.replace(offersHref as never)} />
      </View>
    </ShellScreen>
  )
}

// Opens one offer, or a new one (`id` null, with `type` from the first-time panel skipping the kind picker). An offer that isn't here, or a
// seat that can't read offers, is the shell's 404 or access-denied view (DESIGN.md §4).
export function OfferEditorScreen({ id, type }: { id: string | null; type?: string }) {
  return <OffersGate label={t('offers.screen')}>{(access, client) => (access.viewOnly ? <NoEditing /> : <Loader key={id ?? 'new'} client={client} access={access} id={id} type={kindOf(type)} />)}</OffersGate>
}

const styles = StyleSheet.create({
  box: { padding: 14, gap: 12 },
})
