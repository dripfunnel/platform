import type { ReactNode } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'
import styles from '../styles/shell.module.css'

export const Shell = ({ title, children }: { title: string; children: ReactNode }) => {
  const { store, t } = useStorefront()
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.brand}>{store.name}</p>
        <nav className={styles.nav} aria-label={t('common.nav.label')} />
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </main>
      <footer className={styles.footer}>
        <p>{t('common.footer.note')}</p>
      </footer>
    </div>
  )
}
