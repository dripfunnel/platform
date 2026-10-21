import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { useLeaveGuard } from '../collections/useLeaveGuard'
import { useFeedback } from '../shell/Feedback'
import { SegmentedControl } from '../shell/SegmentedControl'
import type { CartsAccess } from './access'
import { CartsList } from './CartsList'
import { RemindersPane } from './RemindersPane'
import { useCartFacts } from './useCartFacts'

type Pane = 'carts' | 'reminders'

// More › Abandoned carts: the carts, and the reminder settings as a second part. Leaving the settings with changes not saved asks first,
// whether by the other part or by going back.
export function CartsHome({ access, client }: { access: CartsAccess; client: ApiClient }) {
  const feedback = useFeedback()
  const facts = useCartFacts(client)
  const [pane, setPane] = useState<Pane>('carts')
  const [dirty, setDirty] = useState(false)
  useLeaveGuard(dirty)

  const show = (next: Pane) => {
    if (next === pane) return
    if (!dirty) return setPane(next)
    feedback.menu({
      title: t('carts.leave.title'),
      sub: t('carts.leave.body'),
      items: [
        { key: 'keep', label: t('carts.leave.keep'), onPress: () => undefined },
        {
          key: 'discard',
          label: t('carts.leave.discard'),
          danger: true,
          onPress: () => {
            setDirty(false)
            setPane(next)
          },
        },
      ],
    })
  }

  return (
    <View style={styles.root}>
      <SegmentedControl
        segments={[
          { key: 'carts', label: t('carts.panes.carts') },
          { key: 'reminders', label: t('carts.panes.reminders') },
        ]}
        value={pane}
        onChange={show}
      />
      {pane === 'carts' ? <CartsList access={access} client={client} facts={facts} onSetUp={() => setPane('reminders')} /> : <RemindersPane access={access} client={client} onDirty={setDirty} onSaved={facts.reload} />}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
