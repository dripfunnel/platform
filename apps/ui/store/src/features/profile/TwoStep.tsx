import { ConfirmDialog, StatusPill } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import { confirmSecondFactor, regenerateBackupCodes, startSecondFactor, turnOffSecondFactor, type Profile } from '../../api/profile'
import { fill, formatCount, messages, plural } from '../../messages'
import { BackupCodeList, downloadCodes } from '../auth/BackupCodes'
import { productName } from '../auth/fields'
import { Alert, Card, Field, Primary, Secondary } from './parts'
import { lastFour, profileRefusal } from './profileWords'

const words = messages.profile.twoStep

type Method = 'app' | 'sms'

/** Where setting up stands: choosing (turning it on), proving it is you (switching), the first code, then the codes. */
export type Setup =
  | { step: 'pick'; method: Method; switching: false }
  | { step: 'prove'; method: Method; switching: true }
  | { step: 'verify'; method: Method; switching: boolean; secret: string | null; hint: string | null }
  | { step: 'codes'; codes: string[] }

/** A setup key in groups of four, as an authenticator app asks for it. */
export const groupedKey = (secret: string): string => secret.replace(/(.{4})(?=.)/g, '$1 ')

export interface TwoStepProps {
  profile: Profile
  onChanged: () => void
  onToast: (text: string) => void
  /** The harness's opening step, so each of PortalProfile's set-up views can be seen without an API. */
  initialSetup?: Setup | null
}

// "Two-step sign-in" (ACCESS.md §4): an Owner must keep it on and may only switch method; every start,
// switch and off needs the password, and turning it on ends with ten backup codes shown once.
export const TwoStep = ({ profile, onChanged, onToast, initialSetup = null }: TwoStepProps) => {
  const { method, backupCodesLeft, required } = profile.twoFactor
  const [setup, setSetup] = useState<Setup | null>(initialSetup)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<'newCodes' | 'off' | null>(null)
  const last4 = lastFour(profile.phone)
  const on = method !== null

  const go = (next: Setup | null) => {
    setSetup(next)
    setPassword('')
    setCode('')
    setError(null)
  }
  const run = (work: () => Promise<void>) => {
    setBusy(true)
    void work()
      .catch((failure: unknown) => setError(profileRefusal(failure, messages.auth.notConnected)))
      .finally(() => setBusy(false))
  }

  const start = (picked: Method, switching: boolean) => {
    if (!password) return setError(words.passwordMissing)
    if (picked === 'sms' && !profile.phone) return setError(words.needPhone)
    run(async () => {
      const step = await startSecondFactor(picked, password)
      go({ step: 'verify', method: picked, switching, secret: step.secret, hint: step.hint })
    })
  }

  const verify = (current: Extract<Setup, { step: 'verify' }>) => {
    if (!/^\d{6}$/.test(code)) return setError(words.codeIncomplete)
    run(async () => {
      const step = await confirmSecondFactor(current.method, code)
      if (step.backupCodes) return go({ step: 'codes', codes: step.backupCodes })
      go(null)
      onToast(current.method === 'app' ? words.nowApp : words.nowSms)
      onChanged()
    })
  }

  const pill = on ? { label: words.on, tone: 'success' as const, icon: 'ok' as const } : required ? { label: words.needed, tone: 'warning' as const, icon: 'alert' as const } : { label: words.off, tone: 'neutral' as const, icon: 'pause' as const }
  const low = backupCodesLeft <= 3

  return (
    <Card title={words.title} sub={required ? words.whyOwner : words.whyOther} aside={<StatusPill {...pill} />}>
      {on && method && !setup && (
        <>
          <div className="df-profile-rows">
            <div className="df-profile-row">
              <span className="df-profile-row-text">
                <strong>{method === 'app' ? words.app : words.sms}</strong>
                <span>{method === 'app' ? words.appSub : fill(words.smsSub, { last4 })}</span>
              </span>
              <Secondary size="small" onClick={() => go({ step: 'prove', method: method === 'app' ? 'sms' : 'app', switching: true })}>
                {method === 'app' ? words.useSms : words.useApp}
              </Secondary>
            </div>
            <div className="df-profile-row">
              <span className="df-profile-row-text">
                <strong>{words.backup}</strong>
                <span className={low ? 'df-profile-low' : undefined}>
                  {fill(plural(words.left, backupCodesLeft), { count: formatCount(backupCodesLeft) })}
                  {low && words.low}
                </span>
              </span>
              <Secondary size="small" onClick={() => setAsking('newCodes')}>
                {words.newCodes}
              </Secondary>
            </div>
          </div>
          {!required && (
            <button type="button" className="df-profile-link" onClick={() => setAsking('off')}>
              {words.turnOff}
            </button>
          )}
          <Alert text={error} />
        </>
      )}
      {!on && !setup && (
        <div>
          <Primary onClick={() => go({ step: 'pick', method: 'app', switching: false })}>{words.turnOn}</Primary>
        </div>
      )}
      {setup && (
        <div className="df-profile-setup">
          {(setup.step === 'pick' || setup.step === 'prove') && (
            <>
              {setup.step === 'pick' && (
                <>
                  <span className="df-profile-setup-title" id="df-profile-methods">
                    {words.pick}
                  </span>
                  <div role="radiogroup" aria-labelledby="df-profile-methods" className="df-profile-methods">
                    {(['app', 'sms'] as const).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={setup.method === m} className="df-profile-method" onClick={() => setSetup({ ...setup, method: m })}>
                        <span className="df-profile-method-dot" aria-hidden="true" />
                        <span className="df-profile-row-text">
                          <strong>{m === 'app' ? words.app : words.sms}</strong>
                          <span>{m === 'app' ? words.appPick : profile.phone ? fill(words.smsPick, { last4 }) : words.smsNoPhone}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {setup.step === 'prove' && <span className="df-profile-setup-title">{setup.method === 'app' ? words.useApp : words.useSms}</span>}
              <div className="df-profile-narrow">
                <Field label={words.password} type="password" autoComplete="current-password" value={password} onValue={(v) => (setPassword(v), setError(null))} help={words.passwordHelp} />
              </div>
              <Alert text={error} />
              <div className="df-profile-actions">
                <Secondary onClick={() => go(null)}>{words.cancel}</Secondary>
                <Primary busy={busy} onClick={() => start(setup.method, setup.switching)}>
                  {words.next}
                </Primary>
              </div>
            </>
          )}
          {setup.step === 'verify' && (
            <>
              <span className="df-profile-setup-title">{setup.method === 'app' ? fill(words.appTitle, { product: productName() }) : fill(words.smsTitle, { last4: setup.hint ? lastFour(setup.hint) : last4 })}</span>
              {setup.method === 'app' && setup.secret && (
                <div className="df-profile-key">
                  <span>{words.key}</span>
                  <code>{groupedKey(setup.secret)}</code>
                </div>
              )}
              <div className="df-profile-narrow">
                <Field label={words.code} variant="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder={words.codePlaceholder} value={code} onValue={(v) => (setCode(v.replace(/\D/g, '').slice(0, 6)), setError(null))} />
              </div>
              <Alert text={error} />
              <div className="df-profile-actions">
                <Secondary onClick={() => go(null)}>{words.cancel}</Secondary>
                <Primary busy={busy} onClick={() => verify(setup)}>
                  {words.verify}
                </Primary>
              </div>
            </>
          )}
          {setup.step === 'codes' && (
            <>
              <span className="df-profile-setup-title">{words.codesTitle}</span>
              <p className="df-profile-setup-sub">{words.codesSub}</p>
              <BackupCodeList codes={setup.codes} />
              <div className="df-profile-actions">
                <Secondary onClick={() => downloadCodes(setup.codes)}>{words.download}</Secondary>
                <Primary
                  onClick={() => {
                    go(null)
                    onToast(on ? words.codesMade : words.nowOn)
                    onChanged()
                  }}
                >
                  {words.saved}
                </Primary>
              </div>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={asking === 'newCodes'}
        title={words.newTitle}
        target={profile.email}
        consequence={words.newBody}
        confirmLabel={words.newConfirm}
        cancelLabel={words.cancel}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null)
          run(async () => go({ step: 'codes', codes: await regenerateBackupCodes() }))
        }}
      />
      <ConfirmDialog
        open={asking === 'off'}
        danger
        title={words.offTitle}
        target={profile.email}
        consequence={words.offBody}
        confirmLabel={words.offConfirm}
        cancelLabel={words.cancel}
        input={{ label: words.password, type: 'password', initial: '', error: (value) => (value ? null : words.passwordMissing) }}
        onCancel={() => setAsking(null)}
        onConfirm={(_reason, typed) => {
          setAsking(null)
          run(async () => {
            await turnOffSecondFactor(typed ?? '')
            onToast(words.nowOff)
            onChanged()
          })
        }}
      />
    </Card>
  )
}
