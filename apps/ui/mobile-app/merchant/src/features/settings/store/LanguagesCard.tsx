import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadTranslationProgress, saveLanguages, type StoreLocale } from '../../../api/settingsStore'
import type { ApiClient } from '../../../graphql'
import { languageName } from '../../../format'
import { locale, t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { useFeedback } from '../../shell/Feedback'
import { AddFromList } from '../AddFromList'
import { useWrite } from '../useWrite'

type Props = { loc: StoreLocale; client: ApiClient; canEdit: boolean }

// SetStore's languages card: the main language, the others with how much of the catalogue is translated into each (the API counts it), and
// the ones the store can still add. A language left out keeps its translations, hidden.
export function LanguagesCard({ loc, client, canEdit }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const write = useWrite('settingsStore')
  const [saved, setSaved] = useState<string[]>(() => loc.languages.filter((l) => l.status === 'active').map((l) => l.code))
  const [list, setList] = useState<string[]>(saved)
  const [progress, setProgress] = useState<Record<string, string>>({})
  const main = loc.mainLanguage ?? list[0] ?? ''
  const counted = saved.filter((code) => code !== main)

  useEffect(() => {
    let live = true
    const failed = Object.fromEntries(counted.map((code) => [code, t('settings.store.progressFailed')]))
    loadTranslationProgress(client, counted).then(
      (all) =>
        live &&
        setProgress(
          Object.fromEntries(
            counted.map((code) => {
              const found = all.get(code)
              return [code, found ? t('settings.store.translated', { done: found.products - found.untranslated, count: found.products }) : t('settings.store.progressFailed')]
            }),
          ),
        ),
      () => live && setProgress(failed),
    )
    return () => {
      live = false
    }
    // Read again only when the saved languages change; one just added has nothing translated yet.
  }, [counted.join(), client])

  const dirty = JSON.stringify(list) !== JSON.stringify(saved)

  const remove = (code: string) =>
    feedback.sheet({
      title: t('settings.store.removeLanguageTitle', { name: languageName(code, locale) }),
      body: t('settings.store.removeLanguageBody'),
      confirm: t('settings.common.remove'),
      danger: true,
      onConfirm: () => setList((current) => current.filter((c) => c !== code)),
    })

  const save = async () => {
    if (await write.run(async () => (await saveLanguages(client, list, main), t('settings.store.savedLanguages')))) setSaved(list)
  }

  return (
    <SectionCard title={t('settings.store.languages')} sub={t('settings.store.languagesSub')}>
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      {list.map((code) => (
        <View key={code} style={[styles.item, { borderColor: colors.border, borderRadius: radii.button }]}>
          <Text style={[styles.name, { color: colors.heading }]}>{languageName(code, locale)}</Text>
          <Text style={[styles.help, { color: colors.muted }]}>{code === main ? t('settings.store.mainLanguage') : saved.includes(code) ? (progress[code] ?? t('settings.store.progressLoading')) : t('settings.store.notYet')}</Text>
          {canEdit && code !== main ? <Button kind="secondary" label={t('settings.store.removeLanguage', { name: languageName(code, locale) })} onPress={() => remove(code)} /> : null}
        </View>
      ))}
      {canEdit ? (
        <AddFromList
          label={t('settings.store.addLanguage')}
          options={loc.offeredLanguages.filter((code) => !list.includes(code)).map((code) => ({ value: code, label: languageName(code, locale) }))}
          onPick={(code) => setList((current) => [...current, code])}
        />
      ) : null}
      {canEdit ? <Button saves busy={write.busy} disabled={!dirty} label={t('settings.store.saveLanguages')} onPress={() => void save()} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  item: { borderWidth: 1, padding: 12, gap: 8 },
  name: { fontSize: 16, fontWeight: '800' },
  help: { fontSize: 13, lineHeight: 18 },
})
