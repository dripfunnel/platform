import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  connectCourier,
  disconnectCourier,
  saveCourierOptions,
  testCouriers,
  makePricingCourier,
  type Courier,
  type CourierTest,
} from '../../../api/settingsShipping'
import { formatDateTime } from '../../../format'
import { isApiError, type ApiClient } from '../../../graphql'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { useFeedback } from '../../shell/Feedback'
import { ChoiceRows } from '../ChoiceRows'
import { FormSheet } from '../FormSheet'
import { RowCard } from '../RowCard'
import { labelSizeOf, nameOf } from './courierNames'

type Props = { couriers: readonly Courier[]; labelSizes: readonly string[]; timeZone: string; client: ApiClient; canEdit: boolean; readBack: () => Promise<void> }
type Sheet = { kind: 'connect' | 'pricing' | 'manage' | 'disconnect'; courier: Courier }

// Delivery partners: the partner's own accounts with each courier (THIRD-PARTY-ACCESS §4), so connecting asks for no key. A courier that was
// disconnected elsewhere answers NOT_CONNECTED; the list is read again so it shows "Not connected" as it now is.
export function CouriersCard({ couriers, labelSizes, timeZone, client, canEdit, readBack }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [testing, setTesting] = useState(false)
  const [tests, setTests] = useState<CourierTest[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const close = () => setSheet(null)
  const connected = couriers.filter((courier) => courier.status !== 'off').length

  // A refusal because the courier changed elsewhere reads the list again, then stays in the sheet in words.
  const write = async (work: () => Promise<string>): Promise<string> => {
    try {
      const message = await work()
      setTests(null)
      await readBack()
      return message
    } catch (error) {
      if (isApiError(error, 'NOT_CONNECTED') || isApiError(error, 'NOT_FOUND')) await readBack().catch(() => undefined)
      throw error
    }
  }

  const runTests = async () => {
    setTesting(true)
    setFailure(null)
    setTests(null)
    try {
      setTests(await testCouriers(client))
      await readBack()
    } catch (error) {
      setFailure(errorMessage(error, 'settingsShipping'))
    } finally {
      setTesting(false)
    }
  }

  const describe = (courier: Courier): string => {
    const lines = [
      courier.status === 'off'
        ? courier.offered
          ? ''
          : t('settings.shipping.descNotOffered')
        : courier.status === 'failed'
          ? t('settings.shipping.descFailed')
          : courier.status === 'standby'
            ? t('settings.shipping.descStandby')
            : t('settings.shipping.descPricing', { pickup: t(`settings.shipping.pickupModes.${courier.pickupMode}`), label: labelSizeOf(courier.labelSize) }),
      courier.status !== 'off' && courier.lastTestedAt ? t('settings.shipping.lastTested', { time: formatDateTime(courier.lastTestedAt, locale, timeZone) }) : '',
    ]
    return lines.filter(Boolean).join('\n')
  }

  const choose = (courier: Courier) => {
    const name = nameOf(courier.provider)
    if (courier.status === 'off') return courier.offered ? setSheet({ kind: 'connect', courier }) : undefined
    feedback.menu({
      title: name,
      items: [
        ...(courier.status === 'standby' ? [{ key: 'pricing', label: t('settings.shipping.usePricing'), onPress: () => setSheet({ kind: 'pricing', courier }) }] : []),
        { key: 'manage', label: t('settings.shipping.manage'), onPress: () => setSheet({ kind: 'manage', courier }) },
        { key: 'disconnect', label: t('settings.shipping.disconnect'), danger: true, onPress: () => setSheet({ kind: 'disconnect', courier }) },
      ],
    })
  }

  const failed = tests ? tests.filter((test) => test.result !== 'ok').length : 0
  const disconnectBody = (courier: Courier): string => {
    const left = couriers.filter((other) => other.provider !== courier.provider && other.status !== 'off')
    const next = courier.status === 'pricing' ? left.find((other) => other.status === 'standby') : undefined
    return left.length === 0 ? t('settings.shipping.disconnectLast') : next ? t('settings.shipping.disconnectTakesOver', { next: nameOf(next.provider) }) : t('settings.shipping.disconnectStandby')
  }

  return (
    <SectionCard title={t('settings.shipping.partnersTitle')} sub={t('settings.shipping.partnersSub')}>
      {failure ? <Notice kind="error" text={failure} /> : null}
      {tests ? (
        <View style={styles.tests}>
          <Notice
            kind={failed > 0 ? 'error' : 'success'}
            text={[
              tests.length === 0 ? t('settings.shipping.testNone') : failed > 0 ? t('settings.shipping.testSome', { bad: failed, count: tests.length }) : t('settings.shipping.testAllOk', { count: tests.length }),
              ...tests.map((test) => t(`settings.shipping.testResults.${test.result}`, { name: nameOf(test.provider), seconds: new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(test.ms / 1000) })),
            ].join('\n')}
          />
        </View>
      ) : null}
      {couriers.length === 0 ? (
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.shipping.partnersNone')}</Text>
      ) : (
        couriers.map((courier) => (
          <RowCard
            key={courier.provider}
            title={nameOf(courier.provider)}
            sub={describe(courier)}
            status={t(`settings.shipping.status.${courier.status}`)}
            tone={courier.status === 'pricing' ? 'ok' : courier.status === 'failed' ? 'wait' : 'off'}
            onPress={canEdit && (courier.status !== 'off' || courier.offered) ? () => choose(courier) : null}
            accessibilityLabel={t(courier.status === 'off' ? 'settings.shipping.connectName' : 'settings.shipping.manageName', { name: nameOf(courier.provider) })}
          />
        ))
      )}
      {canEdit && connected > 0 ? <Button saves kind="secondary" busy={testing} label={t(testing ? 'settings.shipping.testing' : 'settings.shipping.testAll')} onPress={() => void runTests()} /> : null}
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.shipping.partnersNote')}</Text>

      {sheet?.kind === 'connect' ? (
        <FormSheet
          title={t('settings.shipping.connectName', { name: nameOf(sheet.courier.provider) })}
          body={t('settings.shipping.connectBody', { name: nameOf(sheet.courier.provider) })}
          confirm={t('settings.shipping.connect')}
          context="settingsShipping"
          onClose={close}
          onSubmit={() =>
            write(async () => {
              const status = await connectCourier(client, sheet.courier.provider)
              return t(status === 'pricing' ? 'settings.shipping.connectedPricing' : 'settings.shipping.connectedStandby', { name: nameOf(sheet.courier.provider) })
            })
          }
        />
      ) : null}
      {sheet?.kind === 'pricing' ? (
        <FormSheet
          title={t('settings.shipping.usePricingName', { name: nameOf(sheet.courier.provider) })}
          body={t('settings.shipping.usePricingBody', { name: nameOf(sheet.courier.provider) })}
          confirm={t('settings.shipping.usePricing')}
          context="settingsShipping"
          onClose={close}
          onSubmit={() =>
            write(async () => {
              await makePricingCourier(client, sheet.courier.provider)
              return t('settings.shipping.nowPricing', { name: nameOf(sheet.courier.provider) })
            })
          }
        />
      ) : null}
      {sheet?.kind === 'manage' ? <ManageSheet courier={sheet.courier} labelSizes={labelSizes} client={client} write={write} onClose={close} /> : null}
      {sheet?.kind === 'disconnect' ? (
        <FormSheet
          title={t('settings.shipping.disconnectTitle', { name: nameOf(sheet.courier.provider) })}
          body={disconnectBody(sheet.courier)}
          confirm={t('settings.shipping.disconnect')}
          danger
          context="settingsShipping"
          onClose={close}
          onSubmit={() =>
            write(async () => {
              const now = await disconnectCourier(client, sheet.courier.provider)
              return now ? t('settings.shipping.disconnectedNext', { name: nameOf(sheet.courier.provider), next: nameOf(now) }) : t('settings.shipping.disconnected', { name: nameOf(sheet.courier.provider) })
            })
          }
        />
      ) : null}
    </SectionCard>
  )
}

function ManageSheet({ courier, labelSizes, client, write, onClose }: { courier: Courier; labelSizes: readonly string[]; client: ApiClient; write: (work: () => Promise<string>) => Promise<string>; onClose: () => void }) {
  const [pickup, setPickup] = useState<Courier['pickupMode']>(courier.pickupMode)
  const [label, setLabel] = useState(courier.labelSize)
  const [tracking, setTracking] = useState<'on' | 'off'>(courier.trackingEmails ? 'on' : 'off')
  return (
    <FormSheet
      title={nameOf(courier.provider)}
      body={t('settings.shipping.manageBody', { name: nameOf(courier.provider) })}
      confirm={t('settings.common.save')}
      context="settingsShipping"
      onClose={onClose}
      onSubmit={() =>
        write(async () => {
          await saveCourierOptions(client, courier.provider, { pickupMode: pickup, labelSize: label, trackingEmails: tracking === 'on' })
          return t('settings.shipping.optionsSaved', { name: nameOf(courier.provider) })
        })
      }
    >
      <ChoiceRows
        label={t('settings.shipping.pickupsLabel')}
        value={pickup}
        onChange={setPickup}
        options={[
          { value: 'scheduled', label: t('settings.shipping.pickupChoices.scheduled') },
          { value: 'on_request', label: t('settings.shipping.pickupChoices.on_request') },
        ]}
      />
      <ChoiceRows label={t('settings.shipping.labelLabel')} value={label} onChange={setLabel} options={labelSizes.map((size) => ({ value: size, label: labelSizeOf(size) }))} />
      <ChoiceRows
        label={t('settings.shipping.trackingLabel')}
        value={tracking}
        onChange={setTracking}
        options={[
          { value: 'on', label: t('settings.shipping.trackingChoices.on') },
          { value: 'off', label: t('settings.shipping.trackingChoices.off') },
        ]}
      />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  tests: { gap: 6 },
  sub: { fontSize: 13, lineHeight: 19 },
})
