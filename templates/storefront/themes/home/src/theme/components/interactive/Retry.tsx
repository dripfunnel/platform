'use client'

import { shop as styles } from '../styles/shop'

export const Retry = ({ label, onRetry }: { label: string; onRetry: () => void }) => (
  <button type="button" className={styles.secondary} onClick={onRetry}>
    {label}
  </button>
)
