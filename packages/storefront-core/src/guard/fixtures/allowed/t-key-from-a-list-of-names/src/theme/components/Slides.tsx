import { useStorefront } from '@dripfunnel/storefront-core/theme'

const slides = ['pages.home.title', 'pages.home.lead'] as const

export const Slides = () => {
  const { t } = useStorefront()
  return (
    <ul>
      {slides.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  )
}
