import { accountForRoute, routeProviders, smsProviders, smsRoutes, type SmsProvider, type SmsRoute, type WhatsAppRejection } from '@dripfunnel/shared/messaging'
import { ConfirmDialog, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import {
  messagingManagers,
  removePlatformSms,
  removePlatformWhatsApp,
  savePlatformSms,
  savePlatformWhatsApp,
  setPlatformSmsRoute,
  setPlatformWhatsAppEnabled,
  testPlatformSms,
  testPlatformWhatsApp,
  type MessagingResult,
  type PlatformSms,
} from '../../api/messaging'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { failureText } from '../common/failure'
import { RouteError } from '../common/RouteError'
import { SmsAccountDialog, WhatsAppAccountDialog } from './AccountDialogs'
import { Messaging, MessagingError, problemText, providerName, type MessagingAction, type TestTarget } from './Messaging'
import { messagingStates } from './messagingHarness'

const route = getRouteApi('/_app/settings')
const appRoute = getRouteApi('/_app')
const words = messages.messaging
const sms = words.sms
const wa = words.whatsapp

/** A refusal in words: an SMS one names its provider; a WhatsApp key refusal names what Meta refused. */
export const refusalText = (r: Extract<MessagingResult, { ok: false }>, provider: SmsProvider | null, problem: (rejection: WhatsAppRejection) => string): string => {
  if (!provider) return r.reason === 'KEY_REJECTED' && r.rejection ? problem(r.rejection) : wa.refusals[r.reason]
  return fill(sms.refusals[r.reason], { provider: providerName(provider) })
}

/** What a route's texts go through after a change, by the API's rule: the pick, else the first of its providers that serves it. */
export const routeSentence = (accounts: PlatformSms['accounts'], target: SmsRoute, pick: SmsProvider | null, template: string, none: string): string => {
  const numbers = sms.routeNumbers[target]
  const serving = accountForRoute(accounts, target, pick)
  return serving ? fill(template, { numbers, provider: providerName(serving.provider) }) : fill(none, { numbers })
}

/** Removing an account: what each route it sends now goes through next. */
export const removeConsequence = (data: PlatformSms, provider: SmsProvider): string => {
  const left = data.accounts.filter((a) => a.provider !== provider)
  const changes = smsRoutes.flatMap((target) => {
    const row = data.routes.find((r) => r.route === target)
    return row?.serving === provider ? [routeSentence(left, target, row.provider, sms.removeDialog.route, sms.removeDialog.routeNone)] : []
  })
  return [sms.removeDialog.deleted, ...(changes.length ? changes : [sms.removeDialog.none])].join(' ')
}

export const MessagingScreen = () => {
  const messaging = route.useLoaderData()
  const { me } = appRoute.useLoaderData()
  const forced = useScreenState(messagingStates, harnessEnabled)
  const router = useRouter()
  const [pending, setPending] = useState<MessagingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<TestTarget | null>(null)
  const [rejection, setRejection] = useState<WhatsAppRejection | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const problem = (r: WhatsAppRejection) => problemText(r, messaging.whatsapp)

  const close = () => {
    setPending(null)
    setError(null)
  }
  // A confirmed change: its toast and a fresh read, or its refusal in words with the dialog left open.
  const run = (work: Promise<MessagingResult>, provider: SmsProvider | null, done: string) => {
    setError(null)
    work.then(
      (r) => {
        if (!r.ok) return setError(refusalText(r, provider, problem))
        close()
        setRejection(null)
        setToast(done)
        void router.invalidate()
      },
      (failure: unknown) => setError(failureText(failure, words.failed)),
    )
  }
  const test = (target: TestTarget) => {
    setTesting(target)
    const provider = target === 'whatsapp' ? null : target
    const name = provider ? providerName(provider) : ''
    ;(provider ? testPlatformSms(provider) : testPlatformWhatsApp())
      .then(
        (r) => {
          if (!r.ok) return setToast(refusalText(r, provider, problem))
          if (!provider) setRejection(r.status === 'rejected' ? r.rejection : null)
          const rejected = r.status === 'rejected'
          setToast(provider ? fill(rejected ? sms.toasts.rejected : sms.toasts.ok, { provider: name }) : rejected ? (messaging.whatsapp.enabled ? wa.toasts.rejectedOff : wa.toasts.rejected) : wa.toasts.ok)
        },
        (failure: unknown) => setToast(failureText(failure, words.failed)),
      )
      .finally(() => {
        setTesting(null)
        void router.invalidate()
      })
  }

  const reason = { label: words.reason.label, hint: words.reason.hint }
  const dialog = (() => {
    if (!pending) return null
    switch (pending.kind) {
      case 'smsSave':
        return <SmsAccountDialog provider={pending.provider} error={error} onSave={(input, why) => run(savePlatformSms(input, why), pending.provider, fill(sms.toasts.saved, { provider: providerName(pending.provider) }))} onCancel={close} />
      case 'waSave':
        return (
          <WhatsAppAccountDialog
            current={messaging.whatsapp.account}
            enabled={messaging.whatsapp.enabled}
            error={error}
            onSave={(input, why) => run(savePlatformWhatsApp(input, why), null, wa.toasts.saved)}
            onCancel={close}
          />
        )
      case 'smsRemove': {
        const name = providerName(pending.provider)
        return (
          <ConfirmDialog
            open
            danger
            title={fill(sms.removeDialog.title, { provider: name })}
            target=""
            consequence={removeConsequence(messaging.sms, pending.provider)}
            confirmLabel={sms.removeDialog.confirm}
            cancelLabel={words.cancel}
            reason={reason}
            error={error}
            onConfirm={(why) => run(removePlatformSms(pending.provider, why ?? ''), pending.provider, fill(sms.toasts.removed, { provider: name }))}
            onCancel={close}
          />
        )
      }
      case 'smsRoute': {
        const target = pending.route
        const [first, second] = routeProviders[target]
        const accounts = messaging.sms.accounts
        const automatic = accountForRoute(accounts, target, null)
        const pickOf = (value: string) => smsProviders.find((p) => p === value) ?? null
        const hintOf = (provider: SmsProvider) => {
          const account = accounts.find((a) => a.provider === provider)
          return !account ? sms.routeDialog.hints.missing : accountForRoute([account], target, provider) ? sms.routeDialog.hints.complete : sms.routeDialog.hints.incomplete
        }
        return (
          <ConfirmDialog
            open
            title={fill(sms.routeDialog.title, { numbers: sms.routeNumbers[target] })}
            target=""
            consequence={(_, picked) => routeSentence(accounts, target, pickOf(picked.provider ?? ''), sms.routeDialog.consequence, sms.routeDialog.consequenceNone)}
            confirmLabel={sms.routeDialog.confirm}
            cancelLabel={words.cancel}
            reason={reason}
            choices={[
              {
                key: 'provider',
                label: sms.routeDialog.label,
                options: [
                  { value: '', label: fill(sms.routeDialog.automatic, { first: providerName(first), second: providerName(second) }), hint: automatic ? fill(sms.routeDialog.now, { provider: providerName(automatic.provider) }) : sms.routeDialog.nowNone },
                  ...routeProviders[target].map((p) => ({ value: p, label: providerName(p), hint: hintOf(p) })),
                ],
                initial: messaging.sms.routes.find((r) => r.route === target)?.provider ?? '',
                error: (picked) => {
                  const provider = pickOf(picked)
                  return provider && hintOf(provider) !== sms.routeDialog.hints.complete ? fill(sms.refusals.ACCOUNT_INCOMPLETE, { provider: providerName(provider) }) : null
                },
              },
            ]}
            error={error}
            onConfirm={(why, _, picked) => run(setPlatformSmsRoute(target, pickOf(picked.provider ?? ''), why ?? ''), pickOf(picked.provider ?? ''), sms.toasts.route)}
            onCancel={close}
          />
        )
      }
      case 'waOn':
      case 'waOff':
      case 'waRemove': {
        const text = pending.kind === 'waOn' ? wa.onDialog : pending.kind === 'waOff' ? wa.offDialog : wa.removeDialog
        const work = (why: string) => (pending.kind === 'waRemove' ? removePlatformWhatsApp(why) : setPlatformWhatsAppEnabled(pending.kind === 'waOn', why))
        return (
          <ConfirmDialog
            open
            danger={pending.kind !== 'waOn'}
            title={text.title}
            target=""
            consequence={text.consequence}
            confirmLabel={text.confirm}
            cancelLabel={words.cancel}
            reason={reason}
            error={error}
            onConfirm={(why) => run(work(why ?? ''), null, pending.kind === 'waOn' ? wa.toasts.on : pending.kind === 'waOff' ? wa.toasts.off : wa.toasts.removed)}
            onCancel={close}
          />
        )
      }
    }
  })()

  return (
    <>
      <Messaging
        messaging={messaging}
        forced={forced}
        canManage={messagingManagers.includes(me.role)}
        testing={testing}
        rejection={rejection}
        onAction={(action) => (setError(null), setPending(action))}
        onTest={test}
        onReload={() => void router.invalidate()}
      />
      {dialog}
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const MessagingRouteError = ({ error }: { error: unknown }) => {
  const router = useRouter()
  return <RouteError error={error} view={() => <MessagingError onRetry={() => void router.invalidate()} />} />
}
