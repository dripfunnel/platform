import { useEffect, useId, useState } from 'react'
import { uploadPhoto } from '../../api/productEditor'
import { loadBrand, saveBrand } from '../../api/storefront'
import { messages } from '../../messages'
import { brandFormOf, brandInputOf } from '../storefront/brandDraft'

const words = messages.home.setup.brand

type Which = 'logo' | 'favicon'

/**
 * "Add your logo and favicon" on Home's checklist (FIRST-RELEASE §5): uploads into the storefront brand, keeping every
 * other brand field as saved. The brand needs a logo before a favicon, and the step is done once it has both.
 */
export const BrandStep = ({ label, shopName, onDone }: { label: string; shopName: string; onDone: () => void }) => {
  const id = useId()
  const [busy, setBusy] = useState<Which | null>(null)
  const [added, setAdded] = useState<Record<Which, boolean>>({ logo: false, favicon: false })
  const [failed, setFailed] = useState(false)

  // A logo added before (in Site settings, or on an earlier visit) lets the favicon follow at once.
  useEffect(() => {
    let current = true
    loadBrand().then(
      (b) => current && setAdded((a) => ({ logo: a.logo || Boolean(b?.logoAssetId), favicon: a.favicon || Boolean(b?.faviconAssetId) })),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [])
  useEffect(() => {
    if (added.logo && added.favicon) onDone()
  }, [added, onDone])

  const upload = async (which: Which, file: File) => {
    setBusy(which)
    setFailed(false)
    try {
      const stored = await uploadPhoto(file)
      if (!stored.ok) throw new Error(stored.code)
      const form = brandFormOf(await loadBrand())
      const logoAssetId = which === 'logo' ? stored.assetId : form.logoAssetId
      if (!logoAssetId) throw new Error('NO_LOGO')
      await saveBrand(brandInputOf({ ...form, shopName: form.shopName.trim() || shopName, logoAssetId, ...(which === 'favicon' ? { faviconAssetId: stored.assetId } : {}) }))
      setAdded((a) => ({ ...a, [which]: true }))
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  const picker = (which: Which, disabled: boolean) => (
    <label className={`df-button df-home-step-upload${disabled ? ' df-home-step-upload--off' : ''}`} htmlFor={`${id}-${which}`}>
      {busy === which ? words.uploading : words[which]}
      <input
        id={`${id}-${which}`}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
        className="df-visually-hidden"
        disabled={disabled || busy !== null}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(which, file)
        }}
      />
    </label>
  )

  return (
    <div className="df-home-step-choices">
      <span className="df-home-step-mark" aria-hidden="true" />
      <span className="df-home-step-text">
        <span className="df-home-step-label">{label}</span>
        <span className="df-home-step-note" role="status">
          {[added.logo && words.logoAdded, added.favicon && words.faviconAdded, !added.logo && words.faviconAfterLogo, words.later].filter(Boolean).join(' · ')}
        </span>
        {failed && (
          <span className="df-home-step-owner" role="alert">
            {words.error}
          </span>
        )}
      </span>
      <span className="df-home-step-actions">
        {picker('logo', false)}
        {picker('favicon', !added.logo)}
      </span>
    </div>
  )
}
