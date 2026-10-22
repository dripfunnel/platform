import { z } from 'zod'
import type { Pin } from '../../checkout/address'
import type { Maps, MapsLoader } from './pin'

// The store's half of "Pin on map"'s frame (the API's hooks/mapFrame.ts): Google runs in that frame, on the hooks host, so
// the store's own CSP stays strict (storefront ARCHITECTURE §3.5). The frame is another origin, so all it says is checked.

const loadWaitMs = 15_000
const answerWaitMs = 8_000

const pinSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) })
const part = z.string().max(200).nullable()
const placeSchema = z.object({ line1: part, city: part, region: part, postalCode: z.string().max(20).nullable(), country: z.string().regex(/^[A-Z]{2}$/) })

export const frameMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('failed') }),
  z.object({ type: z.literal('moved'), at: pinSchema }),
  z.object({ type: z.literal('answer'), id: z.number().int(), result: z.unknown() }),
])

/** The map in a sandboxed frame inside `element`, once Google is ready in it; rejected if it fails, or says nothing in 15 s. */
export const frameMaps: MapsLoader = (source, element, title, signal) =>
  new Promise<Maps>((resolve, reject) => {
    const origin = new URL(source).origin
    const frame = document.createElement('iframe')
    frame.title = title
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')
    frame.referrerPolicy = 'strict-origin'
    Object.assign(frame.style, { display: 'block', width: '100%', height: '100%', border: '0' })
    let moved: ((to: Pin) => void) | null = null
    let next = 0
    const waiting = new Map<number, (result: unknown) => void>()
    const post = (message: object) => frame.contentWindow?.postMessage(message, origin)
    const ask = <T>(message: object, schema: z.ZodType<T>) =>
      new Promise<T | null>((done) => {
        const id = ++next
        const timer = setTimeout(() => {
          waiting.delete(id)
          done(null)
        }, answerWaitMs)
        waiting.set(id, (result) => {
          clearTimeout(timer)
          const read = schema.safeParse(result)
          done(read.success ? read.data : null)
        })
        post({ ...message, id })
      })
    const close = () => {
      clearTimeout(timer)
      removeEventListener('message', listen)
      document.removeEventListener('securitypolicyviolation', refused)
      signal.removeEventListener('abort', stop)
      frame.remove()
    }
    const maps: Maps = {
      draw: (_, at, zoom, onMoved) => {
        moved = onMoved
        post({ type: 'draw', at, zoom })
        return { move: (to) => post({ type: 'move', at: to }) }
      },
      find: (address, country) => ask({ type: 'find', address, country }, pinSchema.nullable()),
      place: (at) => ask({ type: 'place', at }, placeSchema.nullable()),
      close,
    }
    const fail = () => {
      close()
      reject(new Error('The map could not load.'))
    }
    const stop = () => fail()
    // A page whose CSP was set before the shop had a map (storefront ARCHITECTURE §3.5) refuses the frame: give up now, not in 15 s.
    const refused = (e: SecurityPolicyViolationEvent) => {
      if (e.effectiveDirective === 'frame-src' && e.blockedURI.startsWith(origin)) fail()
    }
    const timer = setTimeout(fail, loadWaitMs)
    const listen = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.origin !== origin) return
      const message = frameMessageSchema.safeParse(e.data)
      if (!message.success) return
      const m = message.data
      if (m.type === 'ready') {
        // The signal and a CSP refusal cancel loading only; from here the control closes the map itself.
        clearTimeout(timer)
        signal.removeEventListener('abort', stop)
        document.removeEventListener('securitypolicyviolation', refused)
        resolve(maps)
      } else if (m.type === 'failed') fail()
      else if (m.type === 'moved') moved?.(m.at)
      else {
        waiting.get(m.id)?.(m.result)
        waiting.delete(m.id)
      }
    }
    addEventListener('message', listen)
    document.addEventListener('securitypolicyviolation', refused)
    signal.addEventListener('abort', stop)
    frame.addEventListener('load', () => post({ type: 'hello' }))
    frame.src = source
    element.append(frame)
  })
