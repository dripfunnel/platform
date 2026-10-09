// States (?state=): loading, error, readonly, denied, confirm. Without one the screen shows the API's
// branding with its contrast report and what this caller may change.
import { ActionControl, DetailTabs, ErrorState, LoadingState, ReadOnlyNotice } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import { Link } from '@tanstack/react-router'
import type { BrandFile, Branding as BrandingData, ContrastReport } from '../../api/branding'
import type { Me } from '../../api/me'
import { fill, formatCount, messages, plural } from '../../messages'
import { impressumMissing, invalidFields, isDirty, type BrandDraft } from './brandDraft'
import { BrandPreview, type BrandPreviewProps } from './BrandPreview'
import type { BrandingState } from './brandingHarness'
import { LookTab } from './LookTab'
import { WordsTab } from './WordsTab'
import './branding.css'

const words = messages.branding
const screen = messages.screens.branding

export const brandingTabs = ['look', 'words'] as const
export type BrandingTab = (typeof brandingTabs)[number]

export interface BrandingProps {
  me: Me
  branding: BrandingData
  draft: BrandDraft
  original: BrandDraft
  contrast: ContrastReport
  tab: BrandingTab
  forced: BrandingState | null
  busy: boolean
  uploading: BrandFile | null
  preview: Pick<BrandPreviewProps, 'screen' | 'device' | 'mode' | 'onScreen' | 'onDevice' | 'onMode'>
  onDraft: (draft: BrandDraft) => void
  onDiscard: () => void
  onPublish: () => void
  // Uploads a picked file for one of the slots; the screen puts the key it gets back in the draft.
  onUpload: (file: BrandFile, picked: File) => void
  onReload: () => void
}

const Header = ({ product }: { product: string }) => (
  <header className="df-list-header">
    <div className="df-list-heading">
      <h1 className="df-page-title">{screen.title}</h1>
      <p className="df-page-lede">{fill(screen.lede, { product })}</p>
    </div>
  </header>
)

export const BrandingLoading = ({ product }: { product: string }) => (
  <div className="df-page df-list">
    <Header product={product} />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const BrandingError = ({ product, onRetry }: { product: string; onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header product={product} />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const affectsText = (count: number) => (count === 0 ? words.affectsNone : fill(plural(words.affects, count), { count: formatCount(count) }))

export const Branding = ({ me, branding, draft, original, contrast, tab, forced, busy, uploading, preview, onDraft, onDiscard, onPublish, onUpload, onReload }: BrandingProps) => {
  const product = me.partner.product
  if (forced === 'loading') return <BrandingLoading product={product} />
  if (forced === 'error') return <BrandingError product={product} onRetry={onReload} />
  const canEdit = branding.permission.allowed
  const dirty = isDirty(draft, original)
  const invalid = invalidFields(draft)
  const publishRefusal = !canEdit ? words.viewNote : !contrast.passes ? words.fixContrast : invalid.length > 0 ? words.fixFields : impressumMissing(draft, branding) ? words.refused.IMPRESSUM_REQUIRED : null
  return (
    <div className="df-page df-list df-branding">
      <Header product={product} />
      {(me.role === 'partner-read-only' || forced === 'readonly') && <ReadOnlyNotice title={messages.states.readonly.title} body={messages.states.readonly.body} />}
      {!canEdit && <p className="df-editor-note">{words.viewNote}</p>}
      <DetailTabs
        label={words.tabsLabel}
        tabs={brandingTabs}
        labels={words.tabs}
        current={tab}
        link={(next, props) => <Link to="/branding" search={(prev) => ({ ...prev, tab: next === 'look' ? undefined : next })} activeOptions={{ explicitUndefined: true }} {...props} />}
      />
      {dirty && (
        <div role="status" className="df-brand-unpublished">
          <span>
            {words.unpublished} {affectsText(branding.affects)}
          </span>
          <button type="button" className="df-button" disabled={busy} onClick={onDiscard}>
            {words.discard}
          </button>
          <ActionControl label={words.publish} refusal={publishRefusal} primary disabled={busy} onRun={onPublish} />
        </div>
      )}
      <div className="df-brand-layout">
        {tab === 'look' ? (
          <LookTab draft={draft} contrast={contrast} invalid={invalid} disabled={!canEdit || busy} uploading={uploading} onChange={(look) => onDraft({ ...draft, look })} onUpload={onUpload} />
        ) : (
          <WordsTab draft={draft} branding={branding} invalid={invalid} disabled={!canEdit} onChange={(next) => onDraft({ ...draft, words: next })} />
        )}
        <BrandPreview draft={draft} {...preview} />
      </div>
    </div>
  )
}
