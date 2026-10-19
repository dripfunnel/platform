import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { createApiKey, keyNameMax, revokeApiKey, rotateApiKey, type ApiKey, type ApiKeyChoices } from '../../../api/settingsDevelopers'
import type { Supplier } from '../../../api/settingsPeople'
import { formatNumber } from '../../../format'
import type { ApiClient } from '../../../graphql'
import { locale, t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { ChoiceRows } from '../ChoiceRows'
import { FormSheet } from '../FormSheet'
import { RowCard } from '../RowCard'
import { keyLines, scopeName } from './developersView'
import type { Secret } from './SecretCard'

type Props = {
  keys: readonly ApiKey[]
  choices: ApiKeyChoices | null
  suppliers: readonly Supplier[]
  timeZone: string
  client: ApiClient
  canEdit: boolean
  /** A secret is still on screen: another is not made until it is stored. */
  secretShown: boolean
  onSecret: (secret: Secret) => void
  reload: () => Promise<void>
}

type Sheet = { kind: 'create' } | { kind: 'rotate'; key: ApiKey } | { kind: 'revoke'; key: ApiKey }

// Developers › API keys (SetDev; FIRST-RELEASE (store) §15): each key by its prefix only, never its secret.
export function ApiKeysCard({ keys, choices, suppliers, timeZone, client, canEdit, secretShown, onSecret, reload }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const now = new Date()

  const ask = (next: Sheet) => (secretShown ? feedback.toast({ message: t('settings.developers.keys.storeFirst') }) : setSheet(next))

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.developers.keys.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.developers.keys.sub')}</Text>
        {choices ? (
          <Text style={[styles.sub, { color: colors.muted }]}>
            {t('settings.developers.keys.limits', { minute: formatNumber(choices.requestsPerMinute, locale), month: formatNumber(choices.requestsPerMonth, locale) })}
          </Text>
        ) : null}
        {canEdit && choices ? <Button saves label={t('settings.developers.keys.create')} onPress={() => ask({ kind: 'create' })} /> : null}
      </View>
      {keys.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.developers.keys.empty')}</Text> : null}
      {keys.map((key) => (
        <RowCard
          key={key.id}
          title={key.name}
          sub={[`${key.prefix}…`, ...keyLines(key, now, timeZone)].join('\n')}
          onPress={
            canEdit
              ? () =>
                  feedback.menu({
                    title: key.name,
                    sub: `${key.prefix}…`,
                    items: [
                      { key: 'rotate', label: t('settings.developers.keys.rotate'), onPress: () => ask({ kind: 'rotate', key }) },
                      { key: 'revoke', label: t('settings.developers.keys.revoke'), danger: true, onPress: () => ask({ kind: 'revoke', key }) },
                    ],
                  })
              : null
          }
          accessibilityLabel={t('settings.developers.keys.manage', { name: key.name })}
        />
      ))}

      {sheet?.kind === 'create' && choices ? <CreateKeySheet choices={choices} suppliers={suppliers} client={client} onClose={() => setSheet(null)} onSecret={onSecret} reload={reload} /> : null}
      {sheet?.kind === 'rotate' ? (
        <FormSheet
          title={t('settings.developers.keys.rotateTitle', { name: sheet.key.name })}
          body={t('settings.developers.keys.rotateBody')}
          confirm={t('settings.developers.keys.rotateGo')}
          context="settingsDevelopers"
          onClose={() => setSheet(null)}
          onSubmit={async () => {
            const issued = await rotateApiKey(client, sheet.key.id)
            onSecret({ title: t('settings.developers.keys.secretTitle'), warning: t('settings.developers.keys.secretWarn'), value: issued.secret })
            await reload()
            return t('settings.developers.keys.rotated', { name: sheet.key.name })
          }}
        />
      ) : null}
      {sheet?.kind === 'revoke' ? (
        <FormSheet
          title={t('settings.developers.keys.revokeTitle', { name: sheet.key.name })}
          body={t('settings.developers.keys.revokeBody')}
          confirm={t('settings.developers.keys.revokeGo')}
          danger
          context="settingsDevelopers"
          onClose={() => setSheet(null)}
          onSubmit={async () => {
            await revokeApiKey(client, sheet.key.id)
            await reload()
            return t('settings.developers.keys.revoked', { name: sheet.key.name })
          }}
        />
      ) : null}
    </>
  )
}

type CreateProps = { choices: ApiKeyChoices; suppliers: readonly Supplier[]; client: ApiClient; onClose: () => void; onSecret: (secret: Secret) => void; reload: () => Promise<void> }

const whole = 'whole'
const never = 'never'

function CreateKeySheet({ choices, suppliers, client, onClose, onSecret, reload }: CreateProps) {
  const { colors } = useTheme()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<readonly string[]>([])
  const [works, setWorks] = useState(whole)
  const [expires, setExpires] = useState(String(choices.expiresInDays.includes(90) ? 90 : (choices.expiresInDays[0] ?? never)))
  const [tried, setTried] = useState(false)
  const nameMissing = name.trim() === ''
  const active = suppliers.filter((supplier) => supplier.status === 'active')

  return (
    <FormSheet
      title={t('settings.developers.keys.newTitle')}
      confirm={t('settings.developers.keys.createKey')}
      context="settingsDevelopers"
      onClose={onClose}
      check={() => {
        setTried(true)
        if (nameMissing) return t('settings.developers.keys.nameMissing')
        return scopes.length === 0 ? t('settings.developers.keys.scopesMissing') : null
      }}
      onSubmit={async () => {
        const issued = await createApiKey(client, { name: name.trim(), scopes, supplierId: works === whole ? null : works, expiresInDays: expires === never ? null : Number(expires) })
        onSecret({ title: t('settings.developers.keys.secretTitle'), warning: t('settings.developers.keys.secretWarn'), value: issued.secret })
        await reload()
        return t('settings.developers.keys.created', { name: name.trim() })
      }}
    >
      <TextField label={t('settings.developers.keys.name')} value={name} onChangeText={setName} maxLength={keyNameMax} placeholder={t('settings.developers.keys.namePlaceholder')} autoCapitalize="sentences" invalid={tried && nameMissing} />
      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('settings.developers.keys.can')}</Text>
        <View style={styles.chips}>
          {choices.scopes.map((scope) => (
            <Chip key={scope} label={scopeName(scope)} selected={scopes.includes(scope)} onPress={() => setScopes(scopes.includes(scope) ? scopes.filter((other) => other !== scope) : [...scopes, scope])} />
          ))}
        </View>
      </View>
      <ChoiceRows
        label={t('settings.developers.keys.worksFor')}
        value={works}
        onChange={setWorks}
        options={[
          { value: whole, label: t('settings.developers.keys.wholeStore'), sub: t('settings.developers.keys.wholeHelp') },
          ...active.map((supplier) => ({ value: supplier.id, label: t('settings.developers.keys.onlySupplier', { name: supplier.name }), sub: t('settings.developers.keys.supplierHelp') })),
        ]}
      />
      <ChoiceRows
        label={t('settings.developers.keys.expires')}
        value={expires}
        onChange={setExpires}
        options={[
          ...choices.expiresInDays.map((days) => ({ value: String(days), label: tCount('settings.developers.keys.inDays', days, { total: formatNumber(days, locale) }) })),
          { value: never, label: t('settings.developers.keys.never') },
        ]}
      />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
