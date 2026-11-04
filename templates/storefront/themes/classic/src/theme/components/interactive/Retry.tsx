'use client'

import styles from '../../styles/shop.module.css'

export const Retry = ({ label, onRetry }: { label: string; onRetry: () => void }) => (
  <button type="button" className={styles.secondary} onClick={onRetry}>
    {label}
  </button>
)
