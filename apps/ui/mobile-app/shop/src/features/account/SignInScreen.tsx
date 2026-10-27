import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { requestCode, signIn, signInWaysOperation, verifyCode, type Channel } from '../../api/account'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { errorKey } from '../common/errors'
import { Field } from '../common/fields'
import { Button, Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'
import { compact, emailPattern, isPhone, type Problem } from './validation'

/** Back to where the shopper came from (Account, or later the checkout), as the website goes on to `?next=`. */
export const useLeaveAuth = () => {
  const router = useRouter()
  return () => (router.canGoBack() ? router.back() : router.replace('/account'))
}

const problemText = (problem: Problem | undefined, invalid: string): string | null => (problem === 'required' ? t('form.required') : problem === 'invalid' ? invalid : null)

function Refusal({ code }: { code: string | null }) {
  const { colors } = useTheme()
  if (!code) return null
  return (
    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
      {t(errorKey(code))}
    </Text>
  )
}

function Tabs({ ways, channel, onPick }: { ways: { email: boolean; phone: boolean }; channel: Channel; onPick: (channel: Channel) => void }) {
  const { colors, radii } = useTheme()
  if (!(ways.email && ways.phone)) return null
  const tab = (value: Channel, label: string) => (
    <Pressable
      key={value}
      accessibilityRole="tab"
      accessibilityState={{ selected: channel === value }}
      onPress={() => onPick(value)}
      style={[styles.tab, { borderRadius: radii.button, backgroundColor: channel === value ? colors.selected : colors.surface, borderColor: channel === value ? colors.focus : colors.fieldBorder }]}
    >
      <Text style={{ color: colors.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  )
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tab('EMAIL', t('auth.tabs.email'))}
      {tab('PHONE', t('auth.tabs.phone'))}
    </View>
  )
}

function EmailSignIn() {
  const router = useRouter()
  const { client, startSession } = useShop()
  const leave = useLeaveAuth()
  const { colors } = useTheme()
  const action = useAction()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [problems, setProblems] = useState<Partial<Record<'email' | 'password', Problem>>>({})

  const submit = async () => {
    const found: typeof problems = {}
    if (!email.trim()) found.email = 'required'
    else if (!emailPattern.test(email.trim())) found.email = 'invalid'
    if (!password) found.password = 'required'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    const done = await action.run(() => signIn(client, email.trim(), password))
    if (done) {
      await startSession(done.value)
      leave()
    }
  }

  return (
    <View style={styles.form}>
      <Field label={t('auth.email')} value={email} onChangeText={setEmail} error={problemText(problems.email, t('form.invalidEmail'))} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t('auth.password')} value={password} onChangeText={setPassword} error={problemText(problems.password, '')} secure autoCapitalize="none" autoComplete="current-password" textContentType="password" />
      <Refusal code={action.error} />
      <Button label={t('auth.signInButton')} busy={action.busy} onPress={() => void submit()} />
      <View style={styles.links}>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/reset')} style={styles.link}>
          <Text style={{ color: colors.link, fontWeight: '700' }}>{t('auth.forgot')}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/register')} style={styles.link}>
          <Text style={{ color: colors.link, fontWeight: '700' }}>{t('auth.create')}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function PhoneSignIn() {
  const { client, startSession } = useShop()
  const leave = useLeaveAuth()
  const { colors } = useTheme()
  const action = useAction()
  const [phone, setPhone] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState<Problem | undefined>()

  const send = async () => {
    const to = compact(phone)
    setProblem(!to ? 'required' : isPhone(to) ? undefined : 'invalid')
    if (!isPhone(to)) return
    const done = await action.run(() => requestCode(client, 'PHONE', to))
    if (done) {
      setSentTo(to)
      setCode('')
    }
  }

  const confirm = async () => {
    const entered = code.trim()
    setProblem(!entered ? 'required' : /^\d{6}$/.test(entered) ? undefined : 'invalid')
    if (!sentTo || !/^\d{6}$/.test(entered)) return
    const done = await action.run(() => verifyCode(client, { channel: 'PHONE', to: sentTo, code: entered }))
    if (done) {
      await startSession(done.value)
      leave()
    }
  }

  if (sentTo === null) {
    return (
      <View style={styles.form}>
        <Field label={t('auth.phone')} value={phone} onChangeText={setPhone} error={problemText(problem, t('form.invalidPhone'))} autoComplete="tel" keyboardType="phone-pad" textContentType="telephoneNumber" />
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('auth.phoneHelp')}</Text>
        <Refusal code={action.error} />
        <Button label={t('auth.sendCode')} busy={action.busy} onPress={() => void send()} />
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('auth.phoneNote')}</Text>
      </View>
    )
  }
  return (
    <View style={styles.form}>
      <Text style={{ color: colors.textStrong, fontSize: 15 }}>{t('auth.codeSent', { to: sentTo })}</Text>
      <Field label={t('auth.code')} value={code} onChangeText={setCode} error={problemText(problem, t('form.invalidCode'))} autoComplete="sms-otp" keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} />
      <Refusal code={action.error} />
      <Button label={t('auth.signInButton')} busy={action.busy} onPress={() => void confirm()} />
      <Button kind="secondary" label={t('auth.sendAgain')} disabled={action.busy} onPress={() => void send()} />
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          setSentTo(null)
          action.clear()
        }}
        style={styles.link}
      >
        <Text style={{ color: colors.link, fontWeight: '700' }}>{t('auth.differentNumber')}</Text>
      </Pressable>
    </View>
  )
}

// Only the ways the store chose are shown (Settings, Customer accounts; ACCESS.md §2.1).
export function SignInScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { state, retry } = useOperation(signInWaysOperation())
  const [picked, setPicked] = useState<Channel | null>(null)

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('auth.signIn.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Resource state={state} onRetry={retry} skeleton="list">
          {(ways) => {
            if (!ways.email && !ways.phone) return <StateMessage title={t('auth.noMethods.title')} body={t('auth.noMethods.body')} />
            const channel: Channel = picked && ways[picked === 'EMAIL' ? 'email' : 'phone'] ? picked : ways.email ? 'EMAIL' : 'PHONE'
            return (
              <>
                <Tabs ways={ways} channel={channel} onPick={setPicked} />
                {channel === 'EMAIL' ? <EmailSignIn /> : <PhoneSignIn />}
              </>
            )
          }}
        </Resource>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 16, padding: 16, paddingBottom: 40 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  form: { gap: 14 },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { minHeight: 44, justifyContent: 'center' },
})
