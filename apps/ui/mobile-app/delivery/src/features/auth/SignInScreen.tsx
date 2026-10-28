import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { createBrandClient } from '../../api/client'
import { fetchStoreCountry, requestCode, signIn } from '../../api/rider'
import { BrandMark } from '../../brand/BrandMark'
import { errorText, t } from '../../messages'
import { useSession } from '../../session/SessionContext'
import { Button, Field, Refusal, TextButton } from '../common/ui'
import { useAction } from '../common/useAction'
import { CountryPicker } from './CountryPicker'
import { countryOf, dialOf, toE164, type CountryIso } from './phone'
import { useCooldown } from './useCooldown'

/** The wait before another code may be asked for, and the tries the API gives a code (docs/api/DELIVERY.md §4, §5). */
export const resendSeconds = 30
export const triesPerCode = 5

// Number, then code. Signing in is joining, and the answer never says whether the number was invited (docs/api/DELIVERY.md §5).
export function SignInScreen() {
  const router = useRouter()
  const { host, client, startSession } = useSession()
  const { colors } = useTheme()
  const action = useAction()
  const cooldown = useCooldown()
  const [country, setCountry] = useState<CountryIso | null>(null)
  const [national, setNational] = useState('')
  const [picked, setPicked] = useState(false)
  const [invalidPhone, setInvalidPhone] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [invalidCode, setInvalidCode] = useState(false)
  const [refused, setRefused] = useState(0)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    let live = true
    fetchStoreCountry(createBrandClient(host)).then((iso) => live && !picked && setCountry(countryOf(iso)))
    return () => {
      live = false
    }
  }, [host, picked])

  const locked = refused >= triesPerCode || action.error === 'RATE_LIMITED'

  const send = async (resend: boolean) => {
    const number = resend ? sentTo : country ? toE164(dialOf(country), national) : null
    setInvalidPhone(number === null)
    if (number === null) return
    const done = await action.run(() => requestCode(client, number))
    if (!done) return
    setSentTo(number)
    setCode('')
    setRefused(0)
    setInvalidCode(false)
    setResent(resend)
    cooldown.start(resendSeconds)
  }

  const confirm = async () => {
    const entered = code.trim()
    setInvalidCode(!/^\d{6}$/.test(entered))
    if (!sentTo || !/^\d{6}$/.test(entered)) return
    const done = await action.run(() => signIn(client, sentTo, entered))
    if (done) {
      setResent(false)
      await startSession(done.value)
      router.replace('/')
      return
    }
    setCode('')
    setRefused((n) => n + 1)
  }

  const refusal = locked ? errorText('RATE_LIMITED', 'signIn') : action.error ? errorText(action.error, 'signIn') : null

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.page }} contentContainerStyle={styles.body}>
      <View style={styles.brand}>
        <BrandMark />
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('signIn.delivery')}</Text>
      </View>

      {sentTo === null ? (
        <View style={styles.form}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('signIn.phone.title')}
          </Text>
          <Text style={{ color: colors.textStrong }}>{t('signIn.phone.body')}</Text>
          <View style={styles.number}>
            <View style={styles.code}>
              <CountryPicker
                value={country}
                onChange={(iso) => {
                  setPicked(true)
                  setCountry(iso)
                }}
              />
            </View>
            <View style={styles.national}>
              <Field label={t('signIn.phone.number')} value={national} onChangeText={setNational} keyboardType="phone-pad" autoComplete="tel-national" textContentType="telephoneNumber" maxLength={16} hint={t('signIn.phone.numberHint')} />
            </View>
          </View>
          {invalidPhone ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
              {t('signIn.phone.invalid')}
            </Text>
          ) : null}
          <Refusal message={refusal} />
          <Button label={t('signIn.phone.send')} busy={action.busy} onPress={() => void send(false)} />
        </View>
      ) : (
        <View style={styles.form}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('signIn.code.title')}
          </Text>
          <Text style={{ color: colors.textStrong }}>{t('signIn.code.body', { phone: sentTo })}</Text>
          <TextButton
            label={t('signIn.code.change')}
            onPress={() => {
              setSentTo(null)
              setResent(false)
              setRefused(0)
              action.clear()
            }}
          />
          <Field label={t('signIn.code.label')} value={code} onChangeText={(value) => setCode(value.replaceAll(/\D/g, '').slice(0, 6))} editable={!locked} error={invalidCode ? t('signIn.code.invalid') : null} autoComplete="sms-otp" textContentType="oneTimeCode" keyboardType="number-pad" maxLength={6} />
          <Refusal message={refusal} />
          {resent && !refusal ? (
            <Text accessibilityRole="alert" style={{ color: colors.muted, fontSize: 14 }}>
              {t('signIn.code.resent')}
            </Text>
          ) : null}
          <Button label={t('signIn.code.submit')} busy={action.busy} disabled={locked} onPress={() => void confirm()} />
          {locked ? null : cooldown.left > 0 ? (
            <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', minHeight: 44, textAlignVertical: 'center' }}>{t('signIn.code.resendIn', { seconds: cooldown.left })}</Text>
          ) : (
            <TextButton label={t('signIn.code.resend')} disabled={action.busy} onPress={() => void send(true)} />
          )}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, gap: 24, padding: 22, paddingTop: 56, paddingBottom: 40 },
  brand: { alignItems: 'flex-start', gap: 4 },
  form: { gap: 16 },
  title: { fontSize: 26, fontWeight: '800' },
  number: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  code: { width: 132 },
  national: { flex: 1 },
})
