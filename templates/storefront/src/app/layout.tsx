import type { ReactNode } from 'react'
import '../theme/tokens.css'
import './tailwind.css'
import { theme } from '../theme/manifest'
import { readContent } from './content'
import { themeMedia } from './media'
import { Shell } from './Shell'

export const metadata = { title: theme.name }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell content={readContent()} media={themeMedia()}>
          {children}
        </Shell>
      </body>
    </html>
  )
}
