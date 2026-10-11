import { encode } from 'uqr'

// Drawn in the browser so the secret in `value` never leaves it (#365).
export const qrPath = (value: string): { size: number; d: string } => {
  const { size, data } = encode(value, { ecc: 'M', border: 2 })
  const d = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join('')
  return { size, d }
}

export const QrCode = ({ value, label }: { value: string; label: string }) => {
  const { size, d } = qrPath(value)
  return (
    <svg className="df-auth-qr df-auth-qr--code" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <path d={d} />
    </svg>
  )
}
