import { useState } from 'react'
import { messages } from '../../messages'
import type { StorefrontApi } from './storefrontApi'

const refused = messages.storefront.brand.uploadRefused

/** One photo upload at a time for the content editor; `onBusy` lets the editor hold its saves until it ends. */
export const usePhotoUpload = (api: Pick<StorefrontApi, 'uploadImage'>, onBusy: (busy: boolean) => void) => {
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const busy = (now: boolean) => {
    setUploading(now)
    onBusy(now)
  }
  const upload = (file: File, onUploaded: (assetId: string) => void) => {
    busy(true)
    setProblem(null)
    api.uploadImage(file).then(
      (r) => {
        busy(false)
        if (r.ok) onUploaded(r.assetId)
        else setProblem(refused[r.code])
      },
      () => {
        busy(false)
        setProblem(refused.NOT_CONNECTED)
      },
    )
  }
  return { uploading, problem, upload }
}
