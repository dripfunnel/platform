import { useEffect, useRef, useState, type RefObject } from 'react'
import { fill, messages } from '../../messages'

const words = messages.storefront.overview

export const liveDevices = ['desktop', 'phone'] as const
export type LiveDevice = (typeof liveDevices)[number]

// The prototype's Overview (PortalStorefront › Overview): the desktop site 1280 px wide scaled to the card, at most
// 640 px tall; the phone 390 px wide in a 620 px panel.
const desktop = { width: 1280, maxHeight: 640, ratio: 0.62 }
const phone = { width: 390, panel: 620, padding: 16 }
/** A frame that hasn't loaded by then gives way to the version-and-address view. */
export const frameTimeoutMs = 20_000

const useWidth = (ref: RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

const sizeOf = (device: LiveDevice, available: number) => {
  if (device === 'desktop') {
    const scale = available / desktop.width
    const height = Math.min(desktop.maxHeight, Math.round(available * desktop.ratio))
    return { scale, width: available, height, frameWidth: desktop.width, frameHeight: height / scale }
  }
  const scale = Math.min(1, (available - 2 * phone.padding) / phone.width)
  const height = phone.panel - 2 * phone.padding
  return { scale, width: phone.width * scale, height, frameWidth: phone.width, frameHeight: height / scale }
}

export interface LiveFrameProps {
  host: string
  device: LiveDevice
  onFail: () => void
}

/** The live site in a sandboxed frame (FIRST-RELEASE §14), which its CSP allows only to the store's portal (storefront ARCHITECTURE §3.5). */
export const LiveFrame = ({ host, device, onFail }: LiveFrameProps) => {
  const box = useRef<HTMLDivElement>(null)
  const measured = useWidth(box)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) return
    const timer = setTimeout(onFail, frameTimeoutMs)
    return () => clearTimeout(timer)
  }, [loaded, onFail])

  const size = sizeOf(device, measured > 0 ? measured : desktop.width)
  return (
    <div ref={box} className={`df-sf-live-frame df-sf-live-frame--${device}`}>
      <div className="df-sf-live-screen" style={{ width: size.width, height: size.height }}>
        <iframe
          title={fill(words.frameTitle, { host })}
          src={`https://${host}/`}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          style={{ width: size.frameWidth, height: size.frameHeight, transform: `scale(${size.scale})` }}
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  )
}
