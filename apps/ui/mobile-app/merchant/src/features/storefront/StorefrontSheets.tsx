import { discardDraft, goBackToVersion, publishDesign, type StorefrontVersion } from '../../api/storefront'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { FormSheet } from '../settings/FormSheet'
import { versionLabel } from './siteView'

type Common = { client: ApiClient; onClose: () => void }

// Each write says what it does before it does it, and a refusal stays in the sheet in words by its code (errors.storefront).

export function PublishSheet({ client, onClose, next, back, host, onStarted }: Common & { next: number; back: number | null; host: string | null; onStarted: (id: string) => void }) {
  const body = t('storefront.publish.body', { host: host ?? t('storefront.yourShop') })
  return (
    <FormSheet
      title={t('storefront.publish.title', { number: next })}
      body={back === null ? body : `${body} ${t('storefront.publish.back', { number: back })}`}
      confirm={t('storefront.publish.confirm')}
      context="storefront"
      onClose={onClose}
      onSubmit={async () => {
        onStarted(await publishDesign(client))
        return t('storefront.publish.started')
      }}
    />
  )
}

export function DiscardSheet({ client, onClose, onDone }: Common & { onDone: () => Promise<void> }) {
  return (
    <FormSheet
      title={t('storefront.draft.discardTitle')}
      body={t('storefront.draft.discardBody')}
      confirm={t('storefront.draft.discardConfirm')}
      danger
      context="storefront"
      onClose={onClose}
      onSubmit={async () => {
        await discardDraft(client)
        await onDone()
        return t('storefront.draft.discarded')
      }}
    />
  )
}

export function RestoreSheet({ client, onClose, version, onDone }: Common & { version: StorefrontVersion; onDone: () => Promise<void> }) {
  return (
    <FormSheet
      title={t('storefront.versions.restoreTitle', { label: versionLabel(version) })}
      body={t('storefront.versions.restoreBody')}
      confirm={t('storefront.versions.restoreConfirm')}
      context="storefront"
      onClose={onClose}
      onSubmit={async () => {
        await goBackToVersion(client, version.number)
        await onDone()
        return t('storefront.versions.restored')
      }}
    />
  )
}
