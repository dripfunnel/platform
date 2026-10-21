import type { DownloadFile } from '../../../api/productKinds'
import { formatNumber } from '../../../format'
import { locale, t } from '../../../messages'

const types: Record<string, 'pdf' | 'zip' | 'mp3' | 'mp4' | 'webm' | undefined> = { 'application/pdf': 'pdf', 'application/zip': 'zip', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'video/webm': 'webm' }
const megabyte = 1024 * 1024

const sizeOf = (bytes: number): string =>
  bytes >= megabyte ? t('products.kinds.download.sizeMb', { value: formatNumber(Math.round((bytes / megabyte) * 10) / 10, locale) }) : t('products.kinds.download.sizeKb', { value: formatNumber(Math.max(1, Math.round(bytes / 1024)), locale) })

/** "PDF file · 18 MB": the API keeps a download's type and size, never its name. */
export const fileMeta = ({ mime, bytes }: DownloadFile): string => {
  const type = types[mime] ?? (mime.startsWith('image/') ? 'image' : 'other')
  return t('products.kinds.download.fileMeta', { type: t(`products.kinds.download.types.${type}`), size: sizeOf(bytes) })
}
