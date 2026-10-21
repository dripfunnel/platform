import { useCallback, useRef, useState } from 'react'
import { uploadPhoto } from '../../../api/products'
import { isApiError } from '../../../graphql'
import { fileDeps } from '../files'
import { pickFromCamera, pickFromLibrary, type Picked } from '../pickPhoto'
import { maxPhotos, type Draft, type DraftPhoto } from './draft'

type Update = (change: (draft: Draft) => Draft) => void

const patchPhoto = (key: string, patch: Partial<DraftPhoto>) => (draft: Draft): Draft => ({ ...draft, photos: draft.photos.map((photo) => (photo.key === key ? { ...photo, ...patch } : photo)) })

/** Photos from the phone's library or camera, each sent to the API as it is picked (CATALOG-DESIGN.md F1–F2): the draft keeps the progress. */
export function usePhotos(draft: Draft, update: Update) {
  const [cameraDenied, setCameraDenied] = useState(false)
  const counter = useRef(0)
  const room = maxPhotos - draft.photos.length

  const send = useCallback(
    async (key: string, file: Picked) => {
      try {
        const assetId = await uploadPhoto(fileDeps(), file)
        update(patchPhoto(key, { assetId, status: 'ready', code: null }))
      } catch (error) {
        update(patchPhoto(key, { status: 'failed', code: isApiError(error) ? error.code : 'UNKNOWN' }))
      }
    },
    [update],
  )

  const add = useCallback(
    (files: Picked[]) => {
      const taken = files.slice(0, Math.max(0, room))
      const photos: DraftPhoto[] = taken.map((file) => ({ key: `new-${++counter.current}`, assetId: null, path: null, localUri: file.uri, alt: '', versionChoices: null, status: 'uploading', code: null }))
      if (photos.length === 0) return
      update((current) => ({ ...current, photos: [...current.photos, ...photos] }))
      photos.forEach((photo, i) => void send(photo.key, taken[i] as Picked))
    },
    [room, send, update],
  )

  const fromLibrary = useCallback(async () => add(await pickFromLibrary(room)), [add, room])

  const fromCamera = useCallback(async () => {
    const { files, denied } = await pickFromCamera()
    setCameraDenied(denied)
    add(files)
  }, [add])

  const retry = useCallback(
    (key: string) => {
      const photo = draft.photos.find((candidate) => candidate.key === key)
      if (!photo?.localUri) return
      update(patchPhoto(key, { status: 'uploading', code: null }))
      void send(key, { uri: photo.localUri, mimeType: null })
    },
    [draft.photos, send, update],
  )

  return { room, cameraDenied, fromLibrary, fromCamera, retry }
}
