import { z } from 'zod'

// The portal's half of "Pin on map"'s frame (the API's hooks/mapFrame.ts, #815): Google runs in that frame on the hooks
// host, where the browser key is restricted to, never in the portal page. The frame is another origin, so all it says is checked.

export type Pin = { latitude: number; longitude: number }

const placeSchema = z.object({ line1: z.string().max(500).nullable(), city: z.string().max(200).nullable(), region: z.string().max(200).nullable(), postalCode: z.string().max(40).nullable(), country: z.string().regex(/^[A-Z]{2}$/) })
export type FoundAddress = z.infer<typeof placeSchema>

export type FrameMap = {
  draw: (at: Pin, zoom: number, moved: (to: Pin) => void) => void
  move: (to: Pin) => void
  /** The point an address names; null when it can't be found. */
  find: (address: string, country: string) => Promise<Pin | null>
  /** The address at a point; null when there is none. */
  place: (at: Pin) => Promise<FoundAddress | null>
  close: () => void
}

/** Loads the map from `source` into `element`; rejects when it can't, or once `signal` aborts. */
export type FrameLoader = (source: string, element: HTMLElement, title: string, signal: AbortSignal) => Promise<FrameMap>

const loadWaitMs = 15_000
const answerWaitMs = 8_000

const pinSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) })

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('failed') }),
  z.object({ type: z.literal('moved'), at: pinSchema }),
  z.object({ type: z.literal('answer'), id: z.number().int(), result: z.unknown() }),
])

/** The map in a sandboxed frame inside `element`, once Google is ready in it; rejected if it fails, or says nothing in 15 s. */
export const frameMap: FrameLoader = (source, element, title, signal) =>
  new Promise<FrameMap>((resolve, reject) => {
    const origin = new URL(source).origin
    const frame = document.createElement('iframe')
    frame.title = title
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')
    frame.referrerPolicy = 'strict-origin'
    frame.className = 'df-places-map-frame'
    let moved: ((to: Pin) => void) | null = null
    let next = 0
    const waiting = new Map<number, (result: unknown) => void>()
    const post = (message: object) => frame.contentWindow?.postMessage(message, origin)
    const ask = <T,>(message: object, schema: z.ZodType<T>) =>
      new Promise<T | null>((done) => {
        const id = ++next
        const wait = setTimeout(() => {
          waiting.delete(id)
          done(null)
        }, answerWaitMs)
        waiting.set(id, (result) => {
          clearTimeout(wait)
          const read = schema.nullable().safeParse(result)
          done(read.success ? read.data : null)
        })
        post({ ...message, id })
      })
    const close = () => {
      clearTimeout(timer)
      removeEventListener('message', listen)
      signal.removeEventListener('abort', fail)
      frame.remove()
    }
    const map: FrameMap = {
      draw: (at, zoom, onMoved) => {
        moved = onMoved
        post({ type: 'draw', at, zoom })
      },
      move: (to) => post({ type: 'move', at: to }),
      find: (address, country) => ask({ type: 'find', address, country }, pinSchema),
      place: (at) => ask({ type: 'place', at }, placeSchema),
      close,
    }
    function fail() {
      close()
      reject(new Error('The map could not load.'))
    }
    const timer = setTimeout(fail, loadWaitMs)
    const listen = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.origin !== origin) return
      const message = messageSchema.safeParse(e.data)
      if (!message.success) return
      const m = message.data
      if (m.type === 'ready') {
        // The signal cancels loading only; from here the form closes the map itself.
        clearTimeout(timer)
        signal.removeEventListener('abort', fail)
        resolve(map)
      } else if (m.type === 'failed') fail()
      else if (m.type === 'moved') moved?.(m.at)
      else {
        waiting.get(m.id)?.(m.result)
        waiting.delete(m.id)
      }
    }
    addEventListener('message', listen)
    signal.addEventListener('abort', fail)
    frame.addEventListener('load', () => post({ type: 'hello' }))
    frame.src = source
    element.append(frame)
  })
