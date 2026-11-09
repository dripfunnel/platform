import type { ShopClient } from '../platform/api/client'
import { keepShopperToken } from '../platform/api/tokens'

// A shopper's files for an upload question (PLATFORM-PROMPT §5.4 "Uploads"; #1369): `POST {endpoint}/uploads?question=`
// with the raw file, and `DELETE {endpoint}/uploads/{id}`, with the client's own headers (store key, cart token).

export type UploadResult = { ok: true; id: string; kind: 'image' | 'pdf' } | { ok: false; code: string }

const codeOf = (body: unknown): string => {
  const errors = (body as { errors?: { extensions?: { code?: string } }[] } | null)?.errors
  return errors?.[0]?.extensions?.code ?? 'UNKNOWN'
}

/** Sends one file, telling `onProgress` the share sent (0–1); a first file makes the cart and its token is kept. */
export const uploadAnswerFile = (client: ShopClient, questionId: string, file: Blob, onProgress: (sent: number) => void): Promise<UploadResult> =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${client.endpoint}/uploads?question=${encodeURIComponent(questionId)}`)
    for (const [name, value] of Object.entries(client.headers())) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total)
    xhr.onerror = () => resolve({ ok: false, code: 'NETWORK' })
    xhr.onload = () => {
      let body: unknown
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        return resolve({ ok: false, code: 'UNKNOWN' })
      }
      const answer = body as { id?: string; kind?: string; cartToken?: string | null }
      if (xhr.status !== 200 || !answer.id) return resolve({ ok: false, code: codeOf(body) })
      if (answer.cartToken) keepShopperToken('cart', answer.cartToken)
      resolve({ ok: true, id: answer.id, kind: answer.kind === 'pdf' ? 'pdf' : 'image' })
    }
    xhr.send(file)
  })

/** Removes a file the shopper added and no line names yet; null once gone, else the refusal (UPLOAD_IN_USE, …). */
export const removeAnswerFile = async (client: ShopClient, id: string): Promise<string | null> => {
  try {
    const response = await fetch(`${client.endpoint}/uploads/${encodeURIComponent(id)}`, { method: 'DELETE', headers: client.headers() })
    if (response.ok) return null
    return codeOf(await response.json().catch(() => null))
  } catch {
    return 'NETWORK'
  }
}
