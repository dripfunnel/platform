import { View } from 'react-native'
import { maxServiceDuration, maxServiceLocation } from '../../../api/productKinds'
import { t } from '../../../messages'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { Notice } from '../../common/Notice'
import { withDetails, type Draft } from './draft'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; disabled: boolean }

// A service (CatEditor "About the service"): how long it takes and where, both optional; no booking, no shipping, no stock.
export function ServiceCard({ draft, update, disabled }: Props) {
  const { service } = draft.details
  const optional = t('products.kinds.service.optional')
  return (
    <SectionCard title={t('products.kinds.service.title')}>
      <View style={{ gap: 14 }}>
        <TextField
          label={`${t('products.kinds.service.duration')} (${optional})`}
          value={service.duration}
          onChangeText={(duration) => update((d) => withDetails(d, 'service', { duration }))}
          placeholder={t('products.kinds.service.durationPlaceholder')}
          maxLength={maxServiceDuration}
          autoCapitalize="sentences"
          editable={!disabled}
        />
        <TextField
          label={`${t('products.kinds.service.location')} (${optional})`}
          value={service.location}
          onChangeText={(location) => update((d) => withDetails(d, 'service', { location }))}
          placeholder={t('products.kinds.service.locationPlaceholder')}
          maxLength={maxServiceLocation}
          autoCapitalize="sentences"
          editable={!disabled}
        />
        <Notice text={t('products.kinds.service.note')} />
      </View>
    </SectionCard>
  )
}
