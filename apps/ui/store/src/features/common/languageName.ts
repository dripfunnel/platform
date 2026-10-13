import { locale } from '../../messages'

const names = new Intl.DisplayNames([locale], { type: 'language' })

/** "hi-IN" as people say it: Hindi (India); a code Intl can't read stays as it is. */
export const languageName = (code: string): string => {
  try {
    return names.of(code) ?? code
  } catch {
    return code
  }
}
