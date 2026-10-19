import { useCallback } from 'react'
import { uploadDownload } from '../../../api/productKinds'
import { isApiError } from '../../../graphql'
import { pickDocument } from '../../common/pickDocument'
import { fileDeps } from '../files'
import { withDetails, type Draft } from './draft'

type Update = (change: (draft: Draft) => Draft) => void

/** A download's file from the system document picker, sent to the API as it is picked; the draft keeps the progress and the API's refusal. */
export function useDownloadFile(update: Update) {
  return useCallback(async () => {
    const file = await pickDocument().catch(() => null)
    if (!file) return
    update((draft) => withDetails(draft, 'download', { uploading: true, refusal: null }))
    try {
      const stored = await uploadDownload(fileDeps(), file)
      update((draft) => withDetails(draft, 'download', { file: stored, uploading: false }))
    } catch (error) {
      update((draft) => withDetails(draft, 'download', { uploading: false, refusal: isApiError(error) ? error.code : 'UNKNOWN' }))
    }
  }, [update])
}
