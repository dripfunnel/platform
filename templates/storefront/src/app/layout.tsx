import type { ReactNode } from 'react'
import '../theme/tokens.css'
import { theme } from '../theme/manifest'

export const metadata = { title: theme.name }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
