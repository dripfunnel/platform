import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { badgeRules, deleteBadge, loadCatalogueSettings, saveBadge, saveSections, sectionKeys, type Badge, type CatalogueSettings } from '../../../api/settingsCatalogue'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { ChoiceRows } from '../ChoiceRows'
import { FormSheet } from '../FormSheet'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { inPlan, isKnownRule, presetKeys, sameSections, sectionsOf, toneOf, withPreset, type PresetKey, type Sections } from './catalogueView'

// Settings › Catalogue (CatSettings "catalogue"; FIRST-RELEASE (store) §15): what the store sells, which product page sections show (by plan), and the
// badges. Default legal details, custom fields and the plan meters wait for their API (§15), so they are not here.
export function CatalogueTab() {
  return (
    <TabFrame label={t('settings.tabs.catalogue')} load={loadCatalogueSettings}>
      {({ data, client, canEdit }) => <CatalogueBody settings={data} client={client} canEdit={canEdit} />}
    </TabFrame>
  )
}

type Props = { settings: CatalogueSettings; client: ApiClient; canEdit: boolean }
type Sheet = { kind: 'save' } | { kind: 'badge'; badge: Badge | null } | { kind: 'delete'; badge: Badge }

function CatalogueBody({ settings, client, canEdit }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [saved, setSaved] = useState<Sections>(() => sectionsOf(settings))
  const [sections, setSections] = useState<Sections>(saved)
  const [preset, setPreset] = useState<PresetKey | null>(null)
  // Badges read again on their own after a change, so switches not yet saved stay as they are.
  const [badges, setBadges] = useState(settings.badges)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const close = () => setSheet(null)
  const dirty = !sameSections(sections, saved)

  const reread = async () => {
    await loadCatalogueSettings(client).then((latest) => setBadges(latest.badges), () => undefined)
  }

  const choose = (key: PresetKey) => {
    setPreset(key)
    setSections((current) => withPreset(settings, current, key))
    feedback.toast({ message: t('settings.catalogue.presetApplied', { name: t(`settings.catalogue.presets.${key}`) }) })
  }

  const openBadgeMenu = (badge: Badge) =>
    feedback.menu({
      title: badge.label,
      items: [
        { key: 'edit', label: t('settings.common.edit'), onPress: () => setSheet({ kind: 'badge', badge }) },
        { key: 'delete', label: t('settings.catalogue.deleteBadge'), danger: true, onPress: () => setSheet({ kind: 'delete', badge }) },
      ],
    })

  return (
    <>
      <SectionCard title={t('settings.catalogue.sellTitle')} sub={t('settings.catalogue.sellSub')}>
        <View style={styles.chips}>
          {presetKeys.map((key) => (
            <Chip key={key} label={t(`settings.catalogue.presets.${key}`)} selected={preset === key} disabled={!canEdit} onPress={() => choose(key)} />
          ))}
        </View>
      </SectionCard>

      <SectionCard title={t('settings.catalogue.sectionsTitle')}>
        {sectionKeys.map((key) => {
          const allowed = inPlan(settings, key)
          return (
            <View key={key} style={styles.section}>
              <Switch label={t(`settings.catalogue.sections.${key}`)} value={allowed && sections[key]} disabled={!canEdit || !allowed} onChange={() => setSections((current) => ({ ...current, [key]: !current[key] }))} />
              <Text style={[styles.help, { color: colors.muted }]}>{`${t(`settings.catalogue.sectionHelp.${key}`)} · ${allowed ? t('settings.catalogue.included') : t('settings.catalogue.notInPlan')}`}</Text>
            </View>
          )
        })}
        {canEdit ? <Button saves disabled={!dirty} label={t('settings.catalogue.saveSections')} onPress={() => setSheet({ kind: 'save' })} /> : null}
      </SectionCard>

      {saved.badges && inPlan(settings, 'badges') ? (
        <SectionCard title={t('settings.catalogue.badgesTitle')} sub={t('settings.catalogue.badgesSub')}>
          {badges.length === 0 ? <Text style={[styles.help, { color: colors.muted }]}>{t('settings.catalogue.noBadges')}</Text> : null}
          {badges.map((badge) => (
            <RowCard
              key={badge.id}
              title={badge.label}
              sub={isKnownRule(badge.rule) ? t(`settings.catalogue.ruleShort.${badge.rule}`) : t('settings.catalogue.ruleOther')}
              onPress={canEdit ? () => openBadgeMenu(badge) : null}
              accessibilityLabel={t('settings.catalogue.manage', { name: badge.label })}
            />
          ))}
          {canEdit ? <Button saves kind="secondary" label={t('settings.catalogue.addBadge')} onPress={() => setSheet({ kind: 'badge', badge: null })} /> : null}
        </SectionCard>
      ) : null}

      {sheet?.kind === 'save' ? (
        <FormSheet
          title={t('settings.catalogue.saveTitle')}
          body={t('settings.catalogue.saveBody')}
          confirm={t('settings.catalogue.saveSections')}
          context="settingsCatalogue"
          onClose={close}
          onSubmit={async () => {
            await saveSections(client, sectionKeys.map((key) => ({ key, enabled: sections[key] })))
            setSaved(sections)
            return t('settings.catalogue.sectionsSaved')
          }}
        />
      ) : null}
      {sheet?.kind === 'badge' ? <BadgeSheet badge={sheet.badge} nextPosition={badges.reduce((n, badge) => Math.max(n, badge.position + 1), 0)} client={client} onClose={close} onDone={reread} /> : null}
      {sheet?.kind === 'delete' ? (
        <FormSheet
          title={t('settings.catalogue.deleteBadgeTitle', { name: sheet.badge.label })}
          body={t('settings.catalogue.deleteBadgeBody')}
          confirm={t('settings.catalogue.deleteBadge')}
          danger
          context="settingsCatalogue"
          onClose={close}
          onSubmit={async () => {
            await deleteBadge(client, sheet.badge.id)
            await reread()
            return t('settings.catalogue.badgeDeleted')
          }}
        />
      ) : null}
    </>
  )

}

type BadgeProps = { badge: Badge | null; nextPosition: number; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

function BadgeSheet({ badge, nextPosition, client, onClose, onDone }: BadgeProps) {
  const [label, setLabel] = useState(badge?.label ?? '')
  const [rule, setRule] = useState<string>(badge?.rule ?? 'manual')
  const [tried, setTried] = useState(false)
  const problem = label.trim() === '' ? t('settings.catalogue.badgeMissing') : label.trim().length > 18 ? t('settings.catalogue.badgeLong') : null
  // A rule this screen doesn't know (one the API added since) is offered as itself, so editing the text keeps it.
  const options = [
    ...(badge && !isKnownRule(badge.rule) ? [{ value: badge.rule, label: t('settings.catalogue.ruleKept') }] : []),
    ...badgeRules.map((value) => ({ value: value as string, label: t(`settings.catalogue.rules.${value}`) })),
  ]
  return (
    <FormSheet
      title={badge ? t('settings.catalogue.editBadge', { name: badge.label }) : t('settings.catalogue.addBadge')}
      body={t('settings.catalogue.badgeBody')}
      confirm={t('settings.catalogue.saveBadge')}
      context="settingsCatalogue"
      onClose={onClose}
      check={() => {
        setTried(true)
        return problem
      }}
      onSubmit={async () => {
        const known = badgeRules.find((value) => value === rule)
        await saveBadge(client, badge?.id ?? null, { label: label.trim(), rule, tone: known ? toneOf(known) : (badge?.tone ?? 'neutral'), position: badge ? badge.position : nextPosition })
        await onDone()
        return badge ? t('settings.catalogue.badgeSaved') : t(rule === 'manual' ? 'settings.catalogue.badgeAddedManual' : 'settings.catalogue.badgeAddedAuto', { name: label.trim() })
      }}
    >
      <TextField label={t('settings.catalogue.badgeText')} value={label} onChangeText={setLabel} placeholder={t('settings.catalogue.badgePlaceholder')} maxLength={40} autoCapitalize="words" invalid={tried && problem !== null} />
      <ChoiceRows label={t('settings.catalogue.when')} value={rule} options={options} onChange={setRule} />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { gap: 2 },
  help: { fontSize: 13, lineHeight: 18 },
})
