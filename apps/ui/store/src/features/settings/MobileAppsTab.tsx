import { isApiError } from '@dripfunnel/shared/graphql'
import { useId, useState } from 'react'
import { appFiles, appFileUrl, appTextLimits, maxAppFileBytes, saveMobileApps, uploadAppFile, type AppFile, type MobileAppAssets, type MobileAppsInput, type UploadRefusal } from '../../api/mobileApps'
import { fill, formatCount, formatTime, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { refusalIn } from '../common/refusal'
import './mobileApps.css'

const words = messages.settings.mobileApps

const saveRefusal = refusalIn(words.refused)

export interface MobileAppsTabProps {
  current: MobileAppAssets | null
  canEdit: boolean
  onSaved: (toast: string) => void
}

const draftOf = (current: MobileAppAssets | null): MobileAppsInput => ({
  appIcon: current?.appIcon ?? null,
  appIconForeground: current?.appIconForeground ?? null,
  splash: current?.splash ?? null,
  appName: current?.appName ?? '',
  shortDescription: current?.shortDescription ?? '',
  longDescription: current?.longDescription ?? '',
})

const sameDraft = (a: MobileAppsInput, b: MobileAppsInput): boolean =>
  a.appIcon === b.appIcon &&
  a.appIconForeground === b.appIconForeground &&
  a.splash === b.splash &&
  a.appName.trim() === b.appName.trim() &&
  a.shortDescription.trim() === b.shortDescription.trim() &&
  a.longDescription.trim() === b.longDescription.trim()

/** How each picture is shown: the icon as a store rounds it, the foreground inside the circle Android crops it to, the splash on a phone. */
const previewClass: Record<AppFile, string> = { appIcon: 'df-app-preview df-app-preview--icon', appIconForeground: 'df-app-preview df-app-preview--foreground', splash: 'df-app-preview df-app-preview--splash' }

/** SetMobileApps: the Owner gives the store's apps their icon, splash and listing text; each save is a new version a build reads (SH 15). */
export const MobileAppsTab = ({ current, canEdit, onSaved }: MobileAppsTabProps) => {
  const id = useId()
  const [live, setLive] = useState(current)
  const [draft, setDraft] = useState(() => draftOf(current))
  const [uploading, setUploading] = useState<AppFile | null>(null)
  const [fileProblem, setFileProblem] = useState<{ file: AppFile; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const dirty = !sameDraft(draft, draftOf(live))
  const busy = uploading !== null || saving

  const upload = (file: AppFile, picked: File | undefined) => {
    if (!picked || busy) return
    setFileProblem(null)
    // The server checks the type, size and dimensions; the one thing worth saying before sending is that a file this big will be refused.
    if (picked.size > maxAppFileBytes) return setFileProblem({ file, text: words.uploadRefused.TOO_LARGE })
    setUploading(file)
    void uploadAppFile(file, picked).then((result) => {
      setUploading(null)
      if (result.ok) setDraft((now) => ({ ...now, [file]: result.key }))
      else setFileProblem({ file, text: words.uploadRefused[result.code satisfies UploadRefusal] })
    })
  }

  const save = () => {
    if (busy || !dirty) return
    setSaving(true)
    setFailure(null)
    void saveMobileApps(draft).then(
      (saved) => {
        setLive(saved)
        setDraft(draftOf(saved))
        setSaving(false)
        onSaved(fill(words.saved, { version: formatCount(saved.version) }))
      },
      (error: unknown) => {
        setSaving(false)
        setFailure(isApiError(error) ? saveRefusal(error) : words.refused.other)
      },
    )
  }

  const text = (key: 'appName' | 'shortDescription' | 'longDescription', label: string, help: string, multiline = false) => {
    const limit = appTextLimits[key]
    const length = draft[key].length
    const common = {
      id: `${id}-${key}`,
      value: draft[key],
      readOnly: !canEdit,
      maxLength: limit,
      'aria-describedby': `${id}-${key}-count`,
      onChange: (event: { target: { value: string } }) => setDraft((now) => ({ ...now, [key]: event.target.value })),
    }
    return (
      <div className="df-set-field df-set-field--wide">
        <label htmlFor={`${id}-${key}`}>{label}</label>
        <span className="df-set-help">{help}</span>
        {multiline ? <textarea rows={6} {...common} /> : <input {...common} />}
        <span id={`${id}-${key}-count`} className="df-set-help df-app-count">
          {fill(words.counter, { count: formatCount(length), max: formatCount(limit) })}
        </span>
      </div>
    )
  }

  return (
    <div className="df-set-store">
      <section className="df-set-card" aria-labelledby={`${id}-images`}>
        <h2 id={`${id}-images`}>{words.imagesTitle}</h2>
        <p className="df-set-lede">{words.imagesSub}</p>
        <ul className="df-app-files">
          {appFiles.map((file) => {
            const key = draft[file]
            const problem = fileProblem?.file === file ? fileProblem.text : null
            return (
              <li key={file} className="df-app-file">
                <div className={previewClass[file]}>
                  {key ? <AssetImage url={appFileUrl(key)} alt={words.files[file]} className="df-app-image" placeholder={words.previewFailed} /> : <span className="df-app-image df-app-image--none">{words.none}</span>}
                </div>
                <div className="df-app-file-body">
                  <strong>{words.files[file]}</strong>
                  <span className="df-set-help">{words.rules[file]}</span>
                  {problem && (
                    <span className="df-set-problem" role="alert">
                      {problem}
                    </span>
                  )}
                  {uploading === file && (
                    <span className="df-set-help" role="status">
                      {words.uploading}
                    </span>
                  )}
                  {canEdit && (
                    <span className="df-app-actions">
                      <label className={busy ? 'df-button df-button--small df-set-upload df-app-off' : 'df-button df-button--small df-set-upload'}>
                        {key ? words.replace : words.upload}
                        <input type="file" accept="image/png" aria-label={fill(words.pick, { file: words.files[file] })} disabled={busy} onChange={(event) => { upload(file, event.target.files?.[0]); event.target.value = '' }} />
                      </label>
                      {key && (
                        <button type="button" className="df-set-link" disabled={busy} aria-label={fill(words.removeLabel, { file: words.files[file] })} onClick={() => setDraft((now) => ({ ...now, [file]: null }))}>
                          {words.remove}
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="df-set-card" aria-labelledby={`${id}-listing`}>
        <h2 id={`${id}-listing`}>{words.listingTitle}</h2>
        <p className="df-set-lede">{words.listingSub}</p>
        <div className="df-set-grid">
          {text('appName', words.appName, words.appNameHelp)}
          {text('shortDescription', words.shortDescription, words.shortDescriptionHelp)}
          {text('longDescription', words.longDescription, words.longDescriptionHelp, true)}
        </div>
        {failure && (
          <p className="df-set-failure" role="alert">
            {failure}
          </p>
        )}
        <div className="df-set-foot">
          <span className="df-set-help">{live ? fill(words.version, { version: formatCount(live.version), time: formatTime(live.savedAt) }) : words.noVersion}</span>
          {canEdit && (
            <button type="button" className="df-button df-button--primary" disabled={busy || !dirty} onClick={save}>
              {saving ? words.saving : words.save}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
