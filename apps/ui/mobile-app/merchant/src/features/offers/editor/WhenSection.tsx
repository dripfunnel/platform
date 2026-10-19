import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { t } from '../../../messages'
import { Chip } from '../../common/Chip'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { localOf } from '../offerDraft'
import { repeatText, weekdayName, zoneName } from '../offerView'
import { Hint, Label, Problem, WholeField, Wrap, type SectionProps } from './parts'

const day = 86_400_000
const weekdays = [0, 1, 2, 3, 4, 5, 6]

/** A date and a time typed on the store's wall clock, joined as "2026-10-12T09:00"; half-typed is kept as typed and refused at Save. */
function DateTimeField({ label, value, onChange, invalid, disabled }: { label: string; value: string; onChange: (value: string) => void; invalid: boolean; disabled: boolean }) {
  const [date = '', time = ''] = value.split('T')
  return (
    <View style={styles.pair}>
      <View style={styles.half}>
        <TextField label={`${label}: ${t('offers.editor.dateLabel')}`} value={date} onChangeText={(text) => onChange(`${text.trim()}T${time}`)} placeholder={t('offers.editor.datePlaceholder')} keyboardType="numbers-and-punctuation" maxLength={10} editable={!disabled} invalid={invalid} />
      </View>
      <View style={styles.half}>
        <TextField label={`${label}: ${t('offers.editor.timeLabel')}`} value={time} onChangeText={(text) => onChange(`${date}T${text.trim()}`)} placeholder={t('offers.editor.timePlaceholder')} keyboardType="numbers-and-punctuation" maxLength={5} editable={!disabled} invalid={invalid} />
      </View>
    </View>
  )
}

// "When and how often?" (OFFERS-DESIGN K, L): dates in the store's time zone, quick picks, a weekly repeat and the limits.
export function WhenSection({ draft: d, set, errors: e, facts, disabled }: SectionProps) {
  const zone = zoneName(facts.timeZone)
  // Whether a box is showing doesn't follow the text in it, which empties while it is retyped.
  const [startsOnDate, setStartsOnDate] = useState(d.startsAt !== '')
  const [endsOnDate, setEndsOnDate] = useState(d.endsAt !== '')
  const [limited, setLimited] = useState(d.totalUses !== '')
  const today = new Date()
  const date = (instant: number) => localOf(new Date(instant).toISOString(), facts.timeZone).slice(0, 10)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: facts.timeZone, weekday: 'short' }).format(today))
  const toSaturday = (6 - weekday + 7) % 7 || 7
  const [year, month] = date(today.getTime()).split('-').map(Number)
  const monthEnd = new Date(Date.UTC(year ?? 2026, month ?? 1, 0)).toISOString().slice(0, 10)
  const quick = [
    { label: t('offers.editor.quick.weekend'), starts: `${date(today.getTime() + toSaturday * day)}T00:00`, ends: `${date(today.getTime() + (toSaturday + 1) * day)}T23:59` },
    { label: t('offers.editor.quick.week'), starts: '', ends: `${date(today.getTime() + 7 * day)}T23:59` },
    { label: t('offers.editor.quick.month'), starts: '', ends: `${monthEnd}T23:59` },
  ]
  const perCustomerOptions = ['', '1', '2', '3', ...(['', '1', '2', '3'].includes(d.perCustomer) ? [] : [d.perCustomer])]
  const perCustomerLabel = (value: string) => (value === '' ? t('offers.editor.unlimited') : value === '1' ? t('offers.editor.once') : value === '2' ? t('offers.editor.twice') : value === '3' ? t('offers.editor.three') : value)

  return (
    <SectionCard title={t('offers.editor.sections.when')} sub={t('offers.editor.timesIn', { zone })}>
      {!disabled ? (
        <Wrap>
          {quick.map((pick) => (
            <Chip
              key={pick.label}
              label={pick.label}
              onPress={() => {
                setStartsOnDate(pick.starts !== '')
                setEndsOnDate(true)
                set({ startsAt: pick.starts, endsAt: pick.ends })
              }}
            />
          ))}
        </Wrap>
      ) : null}

      <Label text={t('offers.editor.starts')} />
      <Wrap>
        <Chip
          label={t('offers.editor.startsNow')}
          selected={!startsOnDate}
          disabled={disabled}
          onPress={() => {
            setStartsOnDate(false)
            set({ startsAt: '' })
          }}
        />
        <Chip
          label={t('offers.editor.onDate')}
          selected={startsOnDate}
          disabled={disabled}
          onPress={() => {
            setStartsOnDate(true)
            if (!d.startsAt) set({ startsAt: `${date(today.getTime() + day)}T09:00` })
          }}
        />
      </Wrap>
      {startsOnDate ? <DateTimeField label={t('offers.editor.startAt')} value={d.startsAt} onChange={(startsAt) => set({ startsAt })} invalid={Boolean(e.ends)} disabled={disabled} /> : null}

      <Label text={t('offers.editor.ends')} />
      <Wrap>
        <Chip
          label={t('offers.editor.noEnd')}
          selected={!endsOnDate}
          disabled={disabled}
          onPress={() => {
            setEndsOnDate(false)
            set({ endsAt: '' })
          }}
        />
        <Chip
          label={t('offers.editor.onDate')}
          selected={endsOnDate}
          disabled={disabled}
          onPress={() => {
            setEndsOnDate(true)
            if (!d.endsAt) set({ endsAt: `${date(today.getTime() + 7 * day)}T23:59` })
          }}
        />
      </Wrap>
      {endsOnDate ? (
        <>
          <DateTimeField label={t('offers.editor.endAt')} value={d.endsAt} onChange={(endsAt) => set({ endsAt: endsAt.endsWith('T00:00') ? endsAt.replace('T00:00', 'T23:59') : endsAt })} invalid={Boolean(e.ends)} disabled={disabled} />
          {d.endsAt.length === 16 ? <Hint text={t('offers.editor.endHelp', { time: d.endsAt.slice(11), zone })} /> : null}
        </>
      ) : null}
      <Problem text={e.ends} />

      <Switch label={`${t('offers.editor.repeat')}, ${t('offers.editor.repeatSub')}`} value={d.repeat !== null} disabled={disabled} onChange={() => set({ repeat: d.repeat ? null : { days: [5], from: '17:00', to: '21:00' } })} />
      {d.repeat ? (
        <>
          <Wrap>
            {weekdays.map((n) => (
              <Chip
                key={n}
                label={weekdayName(n)}
                selected={d.repeat?.days.includes(n) ?? false}
                disabled={disabled}
                onPress={() => d.repeat && set({ repeat: { ...d.repeat, days: d.repeat.days.includes(n) ? d.repeat.days.filter((x) => x !== n) : [...d.repeat.days, n] } })}
              />
            ))}
          </Wrap>
          <View style={styles.pair}>
            <View style={styles.half}>
              <TextField label={t('offers.editor.from')} value={d.repeat.from} onChangeText={(from) => d.repeat && set({ repeat: { ...d.repeat, from: from.trim() } })} placeholder={t('offers.editor.timePlaceholder')} keyboardType="numbers-and-punctuation" maxLength={5} editable={!disabled} invalid={Boolean(e.repeat)} />
            </View>
            <View style={styles.half}>
              <TextField label={t('offers.editor.toLabel')} value={d.repeat.to} onChangeText={(to) => d.repeat && set({ repeat: { ...d.repeat, to: to.trim() } })} placeholder={t('offers.editor.timePlaceholder')} keyboardType="numbers-and-punctuation" maxLength={5} editable={!disabled} invalid={Boolean(e.repeat)} />
            </View>
          </View>
          {d.repeat.days.length > 0 ? <Hint text={t('offers.editor.repeatNote', { when: repeatText(d.repeat) })} /> : null}
          <Problem text={e.repeat} />
        </>
      ) : null}

      <Label text={t('offers.editor.total')} />
      <Wrap>
        <Chip
          label={t('offers.editor.unlimited')}
          selected={!limited}
          disabled={disabled}
          onPress={() => {
            setLimited(false)
            set({ totalUses: '' })
          }}
        />
        <Chip
          label={t('offers.editor.limitTo')}
          selected={limited}
          disabled={disabled}
          onPress={() => {
            setLimited(true)
            if (!d.totalUses) set({ totalUses: '100' })
          }}
        />
      </Wrap>
      {limited ? <WholeField label={t('offers.editor.totalLabel')} value={d.totalUses} onChange={(totalUses) => set({ totalUses })} invalid={Boolean(e.total)} disabled={disabled} help={d.totalUses ? t('offers.editor.totalStops', { count: d.totalUses }) : t('offers.editor.totalHelp')} /> : <Hint text={t('offers.editor.totalHelp')} />}
      <Problem text={e.total} />

      <Label text={t('offers.editor.perCustomer')} />
      <Wrap>
        {perCustomerOptions.map((value) => (
          <Chip key={value} label={perCustomerLabel(value)} selected={d.perCustomer === value} disabled={disabled} onPress={() => set({ perCustomer: value })} />
        ))}
      </Wrap>
      {d.perCustomer ? <Hint text={t('offers.editor.perCustomerHelp')} /> : null}
      <Problem text={e.perCustomer} />
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
})
