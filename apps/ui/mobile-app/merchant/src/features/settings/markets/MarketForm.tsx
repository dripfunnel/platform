import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { deleteMarket, saveMarket, type Market } from '../../../api/settingsMarkets'
import type { StoreLocale } from '../../../api/settingsStore'
import { isApiError, type ApiClient } from '../../../graphql'
import { formatList, languageName, regionName } from '../../../format'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { SaveBar } from '../../common/SaveBar'
import { useLeaveGuard } from '../../collections/useLeaveGuard'
import { useFeedback } from '../../shell/Feedback'
import { ShellScreen } from '../../states/ShellScreen'
import { AddFromList } from '../AddFromList'
import { ChoiceRows } from '../ChoiceRows'
import { countryCodes, featuredCountries } from '../countries'
import { FormSheet } from '../FormSheet'
import { PickerField } from '../PickerField'
import { bpsOf } from '../percent'
import { ExcludedProducts } from './ExcludedProducts'
import { blankMarket, draftOfMarket, isMarketDirty, marketInputOf, marketProblem, takenBy, type MarketDraft } from './marketDraft'

type Props = {
  client: ApiClient
  markets: readonly Market[]
  loc: StoreLocale
  /** The market opened, or null for a new one named `suggested`. */
  market: Market | null
  suggested: string
  canEdit: boolean
  /** What the last refusal said, shown again after the markets were read again. */
  notice: string | null
  /** Someone else changed or deleted it first: the screen reads the markets again and says why. */
  onStale: (message: string) => void
}

// SetMarkets' editor at phone width: the name and whether it sells, its countries and parent, currency, language, price adjustment, web address
// (the main one or a path on it), the products left out, and duties. The API checks every field again and decides the plan's limits.
export function MarketForm({ client, markets, loc, market, suggested, canEdit, notice, onStale }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [start] = useState<MarketDraft>(() => (market ? draftOfMarket(market) : blankMarket(suggested, loc)))
  const [draft, setDraft] = useState(start)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const dirty = isMarketDirty(draft, start)
  const guard = useLeaveGuard(dirty && !saving)
  const unsaved = dirty || market === null
  const off = !canEdit || saving

  const set = (patch: Partial<MarketDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const tops = markets.filter((other) => other.parentId === null)
  const parent = markets.find((other) => other.id === draft.parentId) ?? null
  const problem = marketProblem(draft, parent?.countries ?? null)
  const taken = takenBy(markets, draft)
  const outsideParent = (country: string) => parent !== null && !parent.countries.includes(country)
  // A sub-market picks from its parent's countries; any it already has outside them stay, marked, until they are taken out.
  const offered = [...new Set([...(parent ? parent.countries : featuredCountries), ...draft.countries])]
  const currencies = [loc.pricingCurrency ?? '', ...loc.currencies.filter((c) => c.status === 'active').map((c) => c.code)].filter(Boolean)
  const languages = loc.languages.filter((l) => l.status === 'active').map((l) => l.code)
  const currencyNote = draft.currency === loc.pricingCurrency ? t('settings.markets.mainCurrency') : loc.currencies.find((c) => c.code === draft.currency)?.mode === 'manual' ? t('settings.markets.typedCurrency') : t('settings.markets.convertedCurrency')

  // What will be saved, not the raw text: a comma is a decimal point to the person typing it.
  const adjustBps = draft.adjust.trim() === '' ? 0 : (bpsOf(draft.adjust, true) ?? 0)
  const preview =
    draft.countries.length === 0
      ? t('settings.markets.pickCountry')
      : t('settings.markets.preview', { country: regionName(draft.countries[0] ?? '', locale), currency: draft.currency, language: languageName(draft.language, locale), where: draft.webMode === 'path' ? `/${draft.pathPrefix || t('settings.markets.pathUnset')}` : t('settings.markets.mainAddress') }) +
        (adjustBps !== 0 ? t('settings.markets.previewAdjust', { adjust: new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(adjustBps / 100) }) : '') +
        (draft.products === 'some' && draft.excluded.length > 0 ? t('settings.markets.previewExcluded', { count: draft.excluded.length }) : '') +
        (draft.duties !== 'none' ? t('settings.markets.previewDuties') : '')

  const where = formatList(draft.countries.map((country) => regionName(country, locale)), locale) || t('settings.markets.theseCountries')
  const subMarkets = markets.filter((other) => other.parentId === draft.id).length
  const deleteBody = [t(market?.everywhereElse ? 'settings.markets.deleteBodyFallback' : 'settings.markets.deleteBody', { countries: where }), subMarkets > 0 ? tCount('settings.markets.deleteSubs', subMarkets) : ''].filter(Boolean).join(' ')

  const refused = (error: unknown) => {
    // Someone else changed or deleted it: read the markets again, so the next try starts from what is saved.
    if (isApiError(error, 'STALE_REVISION') || isApiError(error, 'NOT_FOUND')) onStale(t('settings.markets.reread', { refusal: errorMessage(error, 'settingsMarkets') }))
    else setFailure(errorMessage(error, 'settingsMarkets'))
  }

  const save = async () => {
    setTried(true)
    if (problem !== null) return
    setSaving(true)
    setFailure(null)
    try {
      const stored = await saveMarket(client, draft.id, draft.revision, marketInputOf(draft))
      feedback.toast({ message: t(draft.id === null ? 'settings.markets.created' : 'settings.markets.saved', { name: stored.name }) })
      guard.finish()
    } catch (error) {
      setSaving(false)
      refused(error)
    }
  }

  const pickParent = (id: string) => {
    const chosen = markets.find((other) => other.id === id)
    set(chosen ? { parentId: chosen.id, currency: chosen.currency, language: chosen.language } : { parentId: null })
    if (chosen) feedback.toast({ message: t('settings.markets.copied', { parent: chosen.name, name: draft.name }) })
  }

  return (
    <View style={styles.root}>
      <ShellScreen label={t('settings.tabs.markets')}>
        <View style={styles.content}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.heading }]}>
            {draft.name.trim() || t('settings.markets.untitled')}
          </Text>
          {notice ? <Notice kind="error" text={notice} /> : null}
          {failure ? <Notice kind="error" text={failure} /> : null}
          <SectionCard title={t('settings.markets.name')}>
            <TextField label={t('settings.markets.name')} value={draft.name} onChangeText={(name) => set({ name })} placeholder={t('settings.markets.namePlaceholder')} maxLength={60} editable={!off} autoCapitalize="words" invalid={tried && problem === 'name'} />
            <Switch label={draft.primary || draft.active ? t('settings.markets.selling') : t('settings.markets.notSelling')} value={draft.primary || draft.active} disabled={off || draft.primary} onChange={(active) => set({ active })} />
            <Text style={[styles.help, { color: colors.muted }]}>{preview}</Text>
          </SectionCard>

          <SectionCard title={t('settings.markets.countries')}>
            <View style={styles.chips}>
              {offered.map((country) => {
                const on = draft.countries.includes(country)
                const elsewhere = !on ? taken.get(country) : undefined
                const note = elsewhere ? t('settings.markets.inAnother', { name: elsewhere }) : outsideParent(country) && parent ? t('settings.markets.notParents', { name: parent.name }) : null
                return (
                  <Chip
                    key={country}
                    label={note ? t('settings.markets.chipNote', { country: regionName(country, locale), note }) : regionName(country, locale)}
                    selected={on}
                    disabled={off || elsewhere !== undefined || (!on && outsideParent(country))}
                    onPress={() => set({ countries: on ? draft.countries.filter((other) => other !== country) : [...draft.countries, country] })}
                  />
                )
              })}
            </View>
            {!off ? (
              <AddFromList
                label={t('settings.markets.addCountry')}
                searchable
                options={countryCodes.filter((country) => !offered.includes(country) && !taken.has(country) && !outsideParent(country)).map((country) => ({ value: country, label: regionName(country, locale) }))}
                onPick={(country) => set({ countries: [...draft.countries, country] })}
              />
            ) : null}
            {tried && (problem === 'countries' || problem === 'parentCountries') ? <Text style={[styles.help, { color: colors.danger }]}>{t(`settings.markets.problems.${problem}`)}</Text> : null}
            {!draft.primary ? (
              <PickerField
                label={t('settings.markets.parent')}
                value={draft.parentId ?? ''}
                disabled={off}
                options={[{ value: '', label: t('settings.markets.standsAlone') }, ...tops.filter((other) => other.id !== draft.id).map((other) => ({ value: other.id, label: t('settings.markets.inside', { name: other.name }) }))]}
                onChange={pickParent}
                help={parent ? t('settings.markets.parentCountries', { name: parent.name }) : undefined}
              />
            ) : null}
          </SectionCard>

          <SectionCard title={t('settings.markets.rules')}>
            <PickerField label={t('settings.markets.currency')} value={draft.currency} disabled={off} options={currencies.map((code) => ({ value: code, label: code }))} onChange={(currency) => set({ currency })} help={currencyNote} />
            <PickerField label={t('settings.markets.language')} value={draft.language} disabled={off} options={languages.map((code) => ({ value: code, label: languageName(code, locale) }))} onChange={(language) => set({ language })} help={t('settings.markets.languageHelp')} />
            <TextField label={t('settings.markets.adjust')} value={draft.adjust} onChangeText={(adjust) => set({ adjust: adjust.replace(/[^\d.,-]/g, '') })} placeholder={t('settings.markets.placeholders.adjust')} keyboardType="numbers-and-punctuation" editable={!off} invalid={tried && problem === 'adjust'} help={tried && problem === 'adjust' ? t('settings.markets.problems.adjust') : t('settings.markets.adjustHelp')} />
            <ChoiceRows
              label={t('settings.markets.web')}
              value={draft.webMode}
              disabled={off}
              onChange={(webMode) => set({ webMode })}
              options={[
                { value: 'main', label: t('settings.markets.mainAddress') },
                { value: 'path', label: t('settings.markets.pathAddress') },
              ]}
            />
            {draft.webMode === 'path' ? <TextField label={t('settings.markets.path')} value={draft.pathPrefix} onChangeText={(pathPrefix) => set({ pathPrefix: pathPrefix.toLowerCase() })} placeholder={t('settings.markets.placeholders.path')} maxLength={20} editable={!off} code invalid={tried && problem === 'path'} help={tried && problem === 'path' ? t('settings.markets.problems.path') : t('settings.markets.webHelp')} /> : <Text style={[styles.help, { color: colors.muted }]}>{t('settings.markets.webHelp')}</Text>}
          </SectionCard>

          <SectionCard title={t('settings.markets.productsTitle')}>
            <ChoiceRows
              value={draft.products}
              disabled={off}
              onChange={(products) => set({ products })}
              options={[
                { value: 'all', label: t('settings.markets.allProducts') },
                { value: 'some', label: t('settings.markets.allExcept') },
              ]}
            />
            {draft.products === 'some' ? <ExcludedProducts client={client} excluded={draft.excluded} disabled={off} onChange={(excluded) => set({ excluded })} /> : null}
            <Switch label={t('settings.markets.duties')} value={draft.duties !== 'none'} disabled={off} onChange={(on) => set({ duties: on ? 'by_code' : 'none' })} />
            <Text style={[styles.help, { color: colors.muted }]}>{t('settings.markets.dutiesHelp')}</Text>
            {draft.duties !== 'none' ? (
              <>
                <ChoiceRows
                  label={t('settings.markets.dutyMode')}
                  value={draft.duties}
                  disabled={off}
                  onChange={(duties) => set({ duties })}
                  options={[
                    { value: 'by_code', label: t('settings.markets.byCode') },
                    { value: 'flat', label: t('settings.markets.flat') },
                  ]}
                />
                {draft.duties === 'flat' ? <TextField label={t('settings.markets.dutyRate')} value={draft.dutyRate} onChangeText={(dutyRate) => set({ dutyRate: dutyRate.replace(/[^\d.,]/g, '') })} placeholder={t('settings.markets.placeholders.dutyRate')} keyboardType="decimal-pad" editable={!off} invalid={tried && problem === 'dutyRate'} help={tried && problem === 'dutyRate' ? t('settings.markets.problems.dutyRate') : undefined} /> : null}
                <TextField label={t('settings.markets.dutyMin', { currency: draft.currency })} value={draft.dutyThreshold} onChangeText={(dutyThreshold) => set({ dutyThreshold })} placeholder={t('settings.markets.placeholders.dutyThreshold')} keyboardType="decimal-pad" editable={!off} invalid={tried && problem === 'dutyThreshold'} help={tried && problem === 'dutyThreshold' ? t('settings.markets.problems.dutyThreshold') : t('settings.markets.dutyMinHelp')} />
              </>
            ) : null}
          </SectionCard>

          {tried && problem === 'name' ? <Notice kind="error" text={t('settings.markets.problems.name')} /> : null}
          {canEdit && draft.id && !draft.primary ? <Button saves kind="secondary" label={t('settings.markets.delete')} onPress={() => setDeleting(true)} /> : null}
        </View>
      </ShellScreen>
      {canEdit && unsaved ? <SaveBar failed={failure !== null} label={t('settings.markets.save')} busy={saving} onDiscard={() => setDraft(start)} onSave={() => void save()} /> : null}

      {deleting ? (
        <FormSheet
          title={t('settings.markets.deleteTitle', { name: draft.name })}
          body={deleteBody}
          confirm={t('settings.markets.delete')}
          danger
          context="settingsMarkets"
          onClose={() => setDeleting(false)}
          onSubmit={async () => {
            try {
              if (draft.id) await deleteMarket(client, draft.id)
            } catch (error) {
              if (isApiError(error, 'NOT_FOUND')) {
                onStale(t('settings.markets.reread', { refusal: errorMessage(error, 'settingsMarkets') }))
                return errorMessage(error, 'settingsMarkets')
              }
              throw error
            }
            guard.finish()
            return t('settings.markets.deleted', { name: draft.name })
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  heading: { fontSize: 20, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { fontSize: 13, lineHeight: 18 },
})
