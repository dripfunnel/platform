import { useEffect, useState } from 'react'

// The shell's phone width (store.css); CatList draws cards and drops bulk selection there.
const phoneQuery = '(max-width: 639px)'

const matches = () => typeof matchMedia === 'function' && matchMedia(phoneQuery).matches

export const usePhone = (): boolean => {
  const [phone, setPhone] = useState(matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const list = matchMedia(phoneQuery)
    const changed = () => setPhone(list.matches)
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [])
  return phone
}
