import { StatusPill } from '@dripfunnel/shared/ui'
import { BrandFileImage } from './BrandFileImage'
import { appFiles, brandBackgrounds, brandCorners, brandFiles, brandFonts, hexColour, type BrandFile, type Branding, type ContrastReport } from '../../api/branding'
import { fill, messages } from '../../messages'
import type { BrandDraft, DraftField } from './brandDraft'

const words = messages.branding.look

export interface LookTabProps {
  draft: BrandDraft
  contrast: ContrastReport
  invalid: readonly DraftField[]
  disabled: boolean
  uploading: BrandFile | null
  onChange: (look: Branding['look']) => void
  onUpload: (file: BrandFile, picked: File) => void
}

const appHints: Partial<Record<BrandFile, string>> = words.appHints

const FileRows = ({ files, accept, draft, uploading, disabled, onRemove, onUpload }: { files: readonly BrandFile[]; accept: string; draft: BrandDraft; uploading: BrandFile | null; disabled: boolean; onRemove: (file: BrandFile) => void; onUpload: (file: BrandFile, picked: File) => void }) => (
  <ul className="df-brand-files">
    {files.map((file) => (
      <li key={file}>
        <strong>{words.files[file]}</strong>
        {appHints[file] && <span className="df-field-hint">{appHints[file]}</span>}
        {uploading === file ? (
          <code className="df-muted" role="status">
            {words.uploading}
          </code>
        ) : draft.look.files[file] ? (
          <BrandFileImage className="df-brand-thumb" src={`/api/uploads/brand-file?key=${encodeURIComponent(draft.look.files[file])}`} alt={words.files[file]} fallback={<code className="df-muted">{words.fileFailed}</code>} />
        ) : (
          <code className="df-muted">{words.noFile}</code>
        )}
        <label className={disabled ? 'df-brand-replace df-brand-replace--off' : 'df-brand-replace'}>
          {words.replace}
          <input
            type="file"
            accept={accept}
            className="df-visually-hidden"
            aria-label={fill(words.replaceLabel, { file: words.files[file] })}
            disabled={disabled}
            onChange={(event) => {
              const picked = event.target.files?.[0]
              if (picked) onUpload(file, picked)
              event.target.value = ''
            }}
          />
        </label>
        {draft.look.files[file] && (
          <button type="button" className="df-brand-remove" disabled={disabled} aria-label={fill(words.removeLabel, { file: words.files[file] })} onClick={() => onRemove(file)}>
            {words.remove}
          </button>
        )}
      </li>
    ))}
  </ul>
)

const ColourField = ({ id, label, pickLabel, value, invalid, disabled, onChange }: { id: string; label: string; pickLabel: string; value: string; invalid: boolean; disabled: boolean; onChange: (value: string) => void }) => (
  <div className="df-field">
    <label htmlFor={id}>{label}</label>
    <span className="df-colour">
      <input type="color" value={hexColour.test(value) ? value : '#000000'} aria-label={pickLabel} disabled={disabled} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      <input id={id} type="text" value={value} maxLength={7} spellCheck={false} disabled={disabled} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />
    </span>
    {invalid && (
      <p id={`${id}-error`} className="df-field-hint df-brand-error">
        {words.hexInvalid}
      </p>
    )}
  </div>
)

// The look (§8.1): name, colours with the API's contrast report, font, corners, background, the four files
// and the mobile app's three (#495).
export const LookTab = ({ draft, contrast, invalid, disabled, uploading, onChange, onUpload }: LookTabProps) => {
  const set = (patch: Partial<Branding['look']>) => onChange({ ...draft.look, ...patch })
  const remove = (file: BrandFile) => set({ files: { ...draft.look.files, [file]: '' } })
  return (
    <section className="df-panel df-brand-card" aria-label={messages.branding.tabs.look}>
      <div className="df-field">
        <label htmlFor="brand-product">{words.productName}</label>
        <input id="brand-product" type="text" value={draft.look.productName} maxLength={60} disabled={disabled} aria-invalid={invalid.includes('productName')} onChange={(event) => set({ productName: event.target.value })} />
      </div>
      <div className="df-brand-row">
        <ColourField id="brand-primary" label={words.primary} pickLabel={words.pickPrimary} value={draft.look.primary} invalid={invalid.includes('primary')} disabled={disabled} onChange={(primary) => set({ primary })} />
        <ColourField id="brand-accent" label={words.accent} pickLabel={words.pickAccent} value={draft.look.accent} invalid={invalid.includes('accent')} disabled={disabled} onChange={(accent) => set({ accent })} />
      </div>
      <div className="df-contrast" role="group" aria-label={words.contrast}>
        <span className="df-eyebrow">{words.contrast}</span>
        {contrast.pairs.map((pair) => (
          <div key={pair.key} className="df-contrast-pair">
            <span>
              {words.pairs[pair.key]} · {pair.ratio}
            </span>
            <StatusPill tone={pair.passes ? 'success' : 'danger'} icon={pair.passes ? 'ok' : 'cross'} label={pair.passes ? words.passes : words.fails} />
          </div>
        ))}
        {contrast.fix && (
          <p role="alert" className="df-brand-error">
            {contrast.fix}
          </p>
        )}
      </div>
      <div className="df-brand-row df-brand-row--three">
        <div className="df-field">
          <label htmlFor="brand-font">{words.font}</label>
          <select id="brand-font" value={draft.look.font} disabled={disabled} onChange={(event) => set({ font: brandFonts.find((font) => font === event.target.value) ?? draft.look.font })}>
            {brandFonts.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
        <div className="df-field">
          <label htmlFor="brand-corners">{words.corners}</label>
          <select id="brand-corners" value={draft.look.corner} disabled={disabled} onChange={(event) => set({ corner: brandCorners.find((corner) => corner === event.target.value) ?? draft.look.corner })}>
            {brandCorners.map((corner) => (
              <option key={corner} value={corner}>
                {words.cornerNames[corner]}
              </option>
            ))}
          </select>
        </div>
        <div className="df-field">
          <label htmlFor="brand-background">{words.background}</label>
          <select id="brand-background" value={draft.look.background} disabled={disabled} onChange={(event) => set({ background: brandBackgrounds.find((background) => background === event.target.value) ?? draft.look.background })}>
            {brandBackgrounds.map((background) => (
              <option key={background} value={background}>
                {words.backgrounds[background]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <FileRows files={brandFiles} accept="image/svg+xml,image/png" draft={draft} uploading={uploading} disabled={disabled} onRemove={remove} onUpload={onUpload} />
      <div className="df-brand-group" role="group" aria-labelledby="brand-app-group">
        <span id="brand-app-group" className="df-eyebrow">
          {words.appGroup}
        </span>
        <p className="df-field-hint">{words.appGroupHint}</p>
        <FileRows files={appFiles} accept="image/png" draft={draft} uploading={uploading} disabled={disabled} onRemove={remove} onUpload={onUpload} />
      </div>
    </section>
  )
}
