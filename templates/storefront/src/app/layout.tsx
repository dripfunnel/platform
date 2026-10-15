import type { ReactNode } from 'react'
import '../theme/tokens.css'
import { theme } from '../theme/manifest'
import { readContent } from './content'
import { Shell } from './Shell'

export const metadata = { title: theme.name }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell content={readContent()}>{children}</Shell>
      </body>
    </html>
  )
}
