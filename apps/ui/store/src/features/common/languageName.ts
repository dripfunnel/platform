import { locale } from '../../messages'

const names = new Intl.DisplayNames([locale], { type: 'language' })
/** "hi-IN" as people say it: Hindi (India). */
export const languageName = (code: string): string => names.of(code) ?? code
