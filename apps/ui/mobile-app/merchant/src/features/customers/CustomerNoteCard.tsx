import { useEffect, useState } from 'react'
import { StyleSheet, TextInput } from 'react-native'
import { setCustomerNote, type Customer } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { SectionCard } from '../common/SectionCard'
import type { CustomerWrite } from './customerWrite'

type Props = { client: ApiClient; customer: Customer; canEdit: boolean; write: CustomerWrite; refresh: () => Promise<void> }

// The team-only note: Save appears once it differs from what is kept, and an empty note clears it.
export function CustomerNoteCard({ client, customer, canEdit, write, refresh }: Props) {
  const { colors, radii } = useTheme()
  const [note, setNote] = useState(customer.note ?? '')
  useEffect(() => setNote(customer.note ?? ''), [customer.id, customer.note])

  return (
    <SectionCard title={t('customers.detail.note')} sub={t('customers.detail.noteHint')}>
      <TextInput
        accessibilityLabel={t('customers.detail.note')}
        value={note}
        onChangeText={setNote}
        editable={canEdit}
        multiline
        maxLength={2000}
        placeholder={t('customers.detail.notePlaceholder')}
        placeholderTextColor={colors.muted}
        style={[styles.input, { color: colors.text, borderColor: colors.fieldBorder, borderRadius: radii.button }]}
      />
      {canEdit && note !== (customer.note ?? '') ? (
        <Button
          saves
          label={t('customers.detail.saveNote')}
          busy={write.busy}
          onPress={() =>
            void write.run(async () => {
              await setCustomerNote(client, customer.id, note.trim() || null)
              await refresh()
              return t('customers.detail.noteSaved')
            })
          }
        />
      ) : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, padding: 12, fontSize: 15, minHeight: 88, textAlignVertical: 'top' },
})
