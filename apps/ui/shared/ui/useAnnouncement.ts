import { useEffect, useState } from 'react'

// Screen readers announce a change to a live region, not text it arrived with, so the region
// mounts empty and receives the text once it is in the page.
export const useAnnouncement = (text: string): string => {
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    setAnnouncement(text)
  }, [text])
  return announcement
}
