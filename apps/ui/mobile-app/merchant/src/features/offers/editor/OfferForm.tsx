import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { generateCodes, saveOffer, type OfferKind } from '../../../api/offers'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useLeaveGuard } from '../../collections/useLeaveGuard'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SaveBar } from '../../common/SaveBar'
import { StatusChip } from '../../products/StatusChip'
import { useFeedback } from '../../shell/Feedback'
import { ShellScreen } from '../../states/ShellScreen'
import type { OffersAccess } from '../access'
import { blankDraft, draftOf, errorsOf, inputOf, localOf, offerLimits, offerOf, type Field, type OfferDraft } from '../offerDraft'
import { offerRefusal } from '../offerRefusal'
import { dateTimeText, regionWords, sentence, statusKeyOf, statusTone, zoneName, type OfferNames } from '../offerView'
import { offerHref } from '../routes'
import { AskSheet } from './AskSheet'
import { CombinesSection } from './CombinesSection'
import { HowSection } from './HowSection'
import { KindPicker } from './KindPicker'
import { MustSection } from './MustSection'
import type { OfferEditorData } from './loadEditor'
import { ProductPickerSheet } from './ProductPickerSheet'
import { outlookOf } from './summary'
import { SummaryCard } from './SummaryCard'
import { WhatSection } from './WhatSection'
import { WhenSection } from './WhenSection'
import { WhoSection } from './WhoSection'

type Props = { client: ApiClient; data: OfferEditorData; access: OffersAccess; initialKind: OfferKind | null; onReload: () => void }
type Ask = 'start' | 'live' | null
type Picking = 'productIds' | 'buyIds' | 'getIds' | null

const holderStatuses = ['live', 'scheduled', 'off'] as const

/** A chosen product or customer that's no longer there is shown, and must be removed before a save sends its id. */
const goneErrors = (d: OfferDraft, products: ReadonlyMap<string, string | null>, customers: ReadonlyMap<string, string | null>): Partial<Record<Field, string>> => {
  const gone = (ids: readonly string[], names: ReadonlyMap<string, string | null>) => ids.some((id) => !names.has(id))
  return {
    ...(d.type === 'products' && d.target === 'products' && gone(d.productIds, products) ? { targets: t('offers.editor.errors.gone') } : {}),
    ...(d.type === 'bxgy' && gone(d.buyIds, products) ? { buy: t('offers.editor.errors.gone') } : {}),
    ...(d.type === 'bxgy' && !d.getSame && gone(d.getIds, products) ? { get: t('offers.editor.errors.gone') } : {}),
    ...(d.who === 'customers' && gone(d.customerIds, customers) ? { who: t('offers.editor.errors.gone') } : {}),
  }
}

// The offer editor (OfferEditor.dc.html at phone width; FIRST-RELEASE (store) §8): the kind, then one page of numbered sections in
// OFFERS-DESIGN §1's order with the summary above, and Save asking Start now / Schedule / Keep off on a new offer. Every rule and
// figure is the API's; the form only shapes what it takes and says its limits before the API refuses.
export function OfferForm({ client, data, access, initialKind, onReload }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const feedback = useFeedback()
  const { offer, facts, filters, collections, groups, markets } = data
  const region = regionWords(facts.country)
  const isNew = offer === null

  const [start, setStart] = useState<OfferDraft | null>(() => (offer ? draftOf(offer, facts) : initialKind ? blankDraft(initialKind, region.ship) : null))
  const [draft, setDraft] = useState<OfferDraft | null>(start)
  const [revision, setRevision] = useState<number | null>(offer?.revision ?? null)
  const [productNames, setProductNames] = useState(data.productNames)
  const [customerNames, setCustomerNames] = useState(data.customerNames)
  const [tried, setTried] = useState(false)
  const [codeTaken, setCodeTaken] = useState<string | null>(null)
  const [stale, setStale] = useState<number | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState<Picking>(null)

  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(start)
  const guard = useLeaveGuard(dirty && !saving)

  if (!draft)
    return (
      <ShellScreen label={t('offers.screen')}>
        <View style={styles.content}>
          <KindPicker
            ship={region.ship}
            onPick={(kind) => {
              const blank = blankDraft(kind, region.ship)
              setStart(blank)
              setDraft(blank)
            }}
          />
        </View>
      </ShellScreen>
    )

  const now = new Date()
  const disabled = !access.canEdit || saving
  const names: OfferNames = {
    collections: new Map(collections.map((c) => [c.id, c.name])),
    filterValues: new Map(filters.flatMap((f) => f.values.map((v) => [v.id, `${f.name}: ${v.name}`] as const))),
    groups: new Map(groups.map((g) => [g.id, g.name])),
  }
  const shaped = offerOf(draft, facts)
  const errors = { ...errorsOf(draft, facts), ...goneErrors(draft, productNames, customerNames), ...(codeTaken ? { code: codeTaken } : {}) }
  const errorList = Object.values(errors)
  const set = (patch: Partial<OfferDraft>) => {
    if ('code' in patch) setCodeTaken(null)
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }
  const startsLater = shaped.startsAt !== null && new Date(shaped.startsAt) > now
  const wasLive = offer !== null && offer.enabled && offer.status === 'live'
  const pastEnd = !isNew && shaped.endsAt !== null && new Date(shaped.endsAt) <= now
  const liveCode = wasLive && offer.code ? offer.code : null
  const said = sentence({ ...shaped, code: shaped.code ?? (draft.trigger === 'code' && !draft.singleUse ? t('offers.editor.noCodeYet') : null) }, region, names, now, facts.timeZone)
  const outlook = outlookOf({ draft, facts, region, offer, startsAt: shaped.startsAt, now })
  const marketName = markets.find((m) => m.countries.length === draft.countries.length && m.countries.every((c) => draft.countries.includes(c)))?.name ?? null
  const shared = { draft, set, errors: tried ? errors : codeTaken ? { code: codeTaken } : {}, facts, region, disabled }

  /** Saves the form, on or off; a start cleared when "Start now" is picked. Resolves with the words for a refusal, or null. */
  const commit = async (enabled: boolean, clearStart: boolean): Promise<string | null> => {
    setSaving(true)
    setBanner(null)
    try {
      const saved = await saveOffer(client, offer?.id ?? null, offer ? revision : null, inputOf(clearStart ? { ...draft, startsAt: '' } : draft, facts, enabled))
      let codes = ''
      if (isNew && draft.trigger === 'code' && draft.singleUse) {
        codes = await generateCodes(client, saved.id, { count: Number(draft.batch.count), prefix: draft.batch.prefix.trim().toUpperCase(), length: Number(draft.batch.length) }).then(
          (batch) => tCount('offers.editor.done.codesMade', batch.count),
          (error: unknown) => t('offers.editor.done.codesFailed', { reason: offerRefusal(error) }),
        )
      }
      setAsk(null)
      setStale(null)
      if (!isNew) {
        feedback.toast({ message: enabled && !startsLater ? t('offers.editor.savedLive') : t('offers.editor.saved') })
        guard.finish()
        return null
      }
      const starts = clearStart ? null : shaped.startsAt
      const outcome = !enabled
        ? { title: t('offers.editor.done.off'), body: t('offers.editor.done.offBody') }
        : starts && new Date(starts) > new Date()
          ? { title: t('offers.editor.done.scheduled'), body: t('offers.editor.done.scheduledBody', { date: dateTimeText(starts, facts.timeZone), zone: zoneName(facts.timeZone) }) }
          : shaped.code
            ? { title: t('offers.editor.done.codeLive', { code: shaped.code }), body: t('offers.editor.done.codeLiveBody') }
            : { title: t('offers.editor.done.live'), body: t('offers.editor.done.liveBody') }
      // The saved offer's page replaces this editor, so a second Save can't make a second offer.
      guard.go(() => router.replace(offerHref(saved.id) as never))
      feedback.sheet({ title: outcome.title, body: `${outcome.body}${codes ? ` ${codes}` : ''}`, confirm: t('offers.editor.done.close'), cancel: null, onConfirm: () => undefined })
      return null
    } catch (error) {
      if (isApiError(error, 'CODE_TAKEN')) {
        const name = typeof error.details['name'] === 'string' ? error.details['name'] : ''
        const status = typeof error.details['status'] === 'string' ? error.details['status'] : ''
        const code = shaped.code ?? ''
        setCodeTaken(
          status === 'deleted'
            ? t('offers.editor.codeTaken.deleted', { code, name })
            : status === 'ended' || status === 'used_up'
              ? t('offers.editor.codeTaken.ended', { code, name })
              : (holderStatuses as readonly string[]).includes(status)
                ? t('offers.editor.codeTaken.other', { code, name, status: t(`offers.status.${status as (typeof holderStatuses)[number]}`) })
                : t('offers.editor.codeTaken.unknown', { code, name }),
        )
        setTried(true)
        setAsk(null)
        return null
      }
      if (isApiError(error, 'STALE_REVISION')) {
        setStale(typeof error.details['revision'] === 'number' ? error.details['revision'] : null)
        setAsk(null)
        return null
      }
      return offerRefusal(error)
    } finally {
      setSaving(false)
    }
  }

  const save = () => {
    setTried(true)
    if (Object.keys(errors).length > 0) return
    if (isNew) return setAsk('start')
    if (wasLive) return setAsk('live')
    void commit(offer.enabled, false).then((refused) => refused && setBanner(refused))
  }

  const pickedIds = picking ? draft[picking] : []
  const status = offer ? statusKeyOf(offer, now) : null

  return (
    <View style={styles.root}>
      <ShellScreen label={t('offers.screen')}>
        <View style={styles.content}>
          <View style={styles.head}>
            <Text style={[styles.eyebrow, { color: colors.muted }]}>{t(`offers.kinds.${draft.type}`, { ship: region.ship })}</Text>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
              {offer ? offer.name : t('offers.editor.crumbNew')}
            </Text>
            {status ? <StatusChip label={t(`offers.status.${status}`)} tone={statusTone[status]} /> : null}
          </View>
          {access.readOnly ? <Notice text={`${t('offers.editor.readOnly.title')} ${t('offers.editor.readOnly.body')}`} /> : null}
          {stale !== null ? (
            <View style={styles.stack}>
              <Notice kind="error" text={`${t('offers.editor.stale.title')} ${t('offers.editor.stale.body')}`} />
              <Button kind="secondary" label={t('offers.editor.stale.load')} onPress={onReload} />
              <Button
                kind="secondary"
                label={t('offers.editor.stale.keep')}
                onPress={() => {
                  setRevision(stale)
                  setStale(null)
                }}
              />
            </View>
          ) : null}
          {pastEnd ? (
            <View style={styles.stack}>
              <Notice text={`${t('offers.editor.ended.title')} ${t('offers.editor.ended.body')}`} />
              {!disabled ? <Button kind="secondary" label={t('offers.editor.ended.extend')} onPress={() => set({ endsAt: `${localOf(new Date(Date.now() + 7 * 86_400_000).toISOString(), facts.timeZone).slice(0, 10)}T23:59` })} /> : null}
            </View>
          ) : null}
          {banner ? <Notice kind="error" text={banner} /> : null}
          {tried && errorList.length > 0 ? <Notice kind="error" text={`${tCount('offers.editor.errorsTitle', errorList.length, { count: formatNumber(errorList.length, locale) })} ${errorList.join(' ')}`} /> : null}

          <SummaryCard sentence={said} outlook={outlook} />
          <WhatSection {...shared} filters={filters} collections={collections} productNames={productNames} onPick={setPicking} />
          <HowSection {...shared} isNew={isNew} liveCode={liveCode} />
          <MustSection {...shared} marketName={marketName} />
          <WhoSection {...shared} client={client} groups={groups} markets={markets} customerNames={customerNames} onCustomerName={(id, name) => setCustomerNames((known) => new Map(known).set(id, name))} />
          <WhenSection {...shared} />
          <CombinesSection {...shared} />
        </View>
      </ShellScreen>
      {access.canEdit && (dirty || isNew || tried) ? (
        <SaveBar
          failed={tried && errorList.length > 0}
          label={saving ? t('offers.editor.saving') : isNew ? (startsLater ? t('offers.editor.schedule') : t('offers.editor.save')) : t('offers.editor.saveChanges')}
          busy={saving}
          onDiscard={() => {
            setDraft(start)
            setTried(false)
            setCodeTaken(null)
          }}
          onSave={save}
        />
      ) : null}

      {picking ? (
        <ProductPickerSheet
          client={client}
          chosen={pickedIds}
          limit={offerLimits.ids}
          onToggle={(product, on) => {
            setProductNames((known) => new Map(known).set(product.id, product.name))
            set({ [picking]: on ? [...pickedIds, product.id] : pickedIds.filter((x) => x !== product.id) })
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}

      {ask === 'start' ? (
        <AskSheet
          title={startsLater ? t('offers.editor.ask.titleSchedule') : t('offers.editor.ask.title')}
          body={`${draft.name}. ${outlook.loud ? `${outlook.loud} ` : ''}${said}`}
          choices={[
            { value: 'now', label: t('offers.editor.ask.now') },
            { value: 'schedule', label: startsLater && shaped.startsAt ? t('offers.editor.ask.schedule', { date: dateTimeText(shaped.startsAt, facts.timeZone) }) : t('offers.editor.ask.scheduleNeedsDate') },
            { value: 'off', label: t('offers.editor.ask.off') },
          ]}
          initial={startsLater ? 'schedule' : 'now'}
          confirm={t('offers.editor.ask.confirm')}
          check={(choice) => (choice === 'schedule' && !startsLater ? t('offers.editor.ask.needsDate') : null)}
          onSubmit={(choice) => commit(choice !== 'off', choice === 'now')}
          onClose={() => setAsk(null)}
        />
      ) : null}
      {ask === 'live' && offer ? (
        <AskSheet
          title={t('offers.editor.live.title')}
          body={`${t('offers.editor.live.body')}${liveCode && shaped.code !== liveCode ? ` ${t('offers.editor.live.oldCode', { code: liveCode })}` : ''}`}
          confirm={t('offers.editor.live.confirm')}
          onSubmit={() => commit(offer.enabled, false)}
          onClose={() => setAsk(null)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 6 },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800' },
  stack: { gap: 8 },
})
