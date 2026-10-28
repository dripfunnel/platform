import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { requestCode, verifyCode } from '../../api/account'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { errorKey } from '../common/errors'
import { Field } from '../common/fields'
import { Button, ScreenHeader } from '../common/ui'
import { useAction } from '../common/useAction'
import { useLeaveAuth } from './SignInScreen'
import { emailPattern, minPasswordLength, type Problem } from './validation'

type Problems = Partial<Record<'email' | 'code' | 'name' | 'password', Problem>>

const text = (problem: Problem | undefined, invalid: string): string | null => (problem === 'required' ? t('form.required') : problem === 'invalid' ? invalid : null)

// Making an account and forgetting a password are one flow on the API: a code proves the email, and with it a password is set
// (ACCESS.md §2.1). Registering also names the account.
export function EmailCodeScreen({ mode }: { mode: 'register' | 'reset' }) {
  const router = useRouter()
  const { client, startSession } = useShop()
  const leave = useLeaveAuth()
  const { colors } = useTheme()
  const action = useAction()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  const register = mode === 'register'

  const send = async () => {
    const to = email.trim()
    const problem: Problem | undefined = !to ? 'required' : emailPattern.test(to) ? undefined : 'invalid'
    setProblems(problem ? { email: problem } : {})
    if (problem) return
    const done = await action.run(() => requestCode(client, 'EMAIL', to))
    if (done) {
      setSentTo(to)
      setCode('')
    }
  }

  const confirm = async () => {
    const found: Problems = {}
    if (!/^\d{6}$/.test(code.trim())) found.code = code.trim() ? 'invalid' : 'required'
    if (register && !name.trim()) found.name = 'required'
    if (password.length < minPasswordLength) found.password = password ? 'invalid' : 'required'
    setProblems(found)
    if (!sentTo || Object.keys(found).length > 0) return
    const done = await action.run(() => verifyCode(client, { channel: 'EMAIL', to: sentTo, code: code.trim(), ...(register ? { name: name.trim() } : {}), password }))
    if (done) {
      await startSession(done.value)
      leave()
    }
  }

  const error = action.error ? (
    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
      {t(errorKey(action.error))}
    </Text>
  ) : null

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t(register ? 'auth.register.title' : 'auth.reset.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {sentTo === null ? (
          <>
            <Text style={{ color: colors.textStrong, fontSize: 15 }}>{t(register ? 'auth.register.intro' : 'auth.reset.intro')}</Text>
            <Field label={t('auth.email')} value={email} onChangeText={setEmail} error={text(problems.email, t('form.invalidEmail'))} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
            {error}
            <Button saves label={t('auth.sendCode')} busy={action.busy} onPress={() => void send()} />
          </>
        ) : (
          <>
            <Text style={{ color: colors.textStrong, fontSize: 15 }}>{t('auth.codeSent', { to: sentTo })}</Text>
            <Field label={t('auth.code')} value={code} onChangeText={setCode} error={text(problems.code, t('form.invalidCode'))} autoComplete="sms-otp" keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} />
            {register ? <Field label={t('auth.register.name')} value={name} onChangeText={setName} error={text(problems.name, '')} autoComplete="name" textContentType="name" /> : null}
            <Field
              label={t(register ? 'auth.password' : 'auth.reset.newPassword')}
              value={password}
              onChangeText={setPassword}
              error={text(problems.password, t('form.shortPassword'))}
              secure
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
            />
            <Text style={{ color: colors.muted, fontSize: 13 }}>{t('auth.passwordHelp')}</Text>
            {error}
            <Button saves label={t(register ? 'auth.register.button' : 'auth.reset.button')} busy={action.busy} onPress={() => void confirm()} />
            <Button saves kind="secondary" label={t('auth.sendAgain')} disabled={action.busy} onPress={() => void send()} />
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                setSentTo(null)
                action.clear()
              }}
              style={styles.link}
            >
              <Text style={{ color: colors.link, fontWeight: '700' }}>{t('auth.differentEmail')}</Text>
            </Pressable>
          </>
        )}
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-in')} style={styles.link}>
          <Text style={{ color: colors.link, fontWeight: '700' }}>{t('auth.haveAccount')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 14, padding: 16, paddingBottom: 40 },
  link: { minHeight: 44, justifyContent: 'center' },
})
