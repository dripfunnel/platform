import { useEffect, useState } from 'react'

/** Whether the browser says it's online: the shell's offline banner and an import paused while it's away. */
export const useOnline = () => {
  // Only an explicit `false` is offline: a browser without the flag is taken at its word that it works.
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
