import { fromBase64, maxImageSide, readImage, type ImageType } from './media.js'
import { problem, type GuardContext, type Problem, type ThemeFile } from './rules.js'

export const maxFiles = 200
export const maxFileBytes = 100 * 1024
export const maxThemeBytes = 2 * 1024 * 1024
export const maxMediaFiles = 100
export const maxMediaBytes = 2 * 1024 * 1024
export const maxMediaTotalBytes = 20 * 1024 * 1024

// Plain ASCII names only, so no `..`, `.`, case trick, look-alike letter or backslash can name another file.
const name = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'
const folders = `(?:${name}/){0,4}`

export const codePath = new RegExp(`^src/theme/(?:pages|components)/${folders}${name}\\.tsx$`)
export const cssPath = new RegExp(`^src/theme/styles/${folders}${name}\\.module\\.css$`)
/** The theme's Tailwind entry: its tokens as `@theme` values and its keyframes (ARCHITECTURE §3.4 "Classes"). */
export const themeCssPath = 'src/theme/styles/theme.css'
export const contentPath = /^content\/([a-z]{2,3}(?:-[A-Z]{2})?)\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.json$/
export const routesPath = 'routes.json'
export const interactiveFolder = 'src/theme/components/interactive/'
export const mediaFolder = 'src/theme/media/'
export const mediaPath = new RegExp(`^src/theme/media/(${name}\\.(?:png|jpg|jpeg|webp))$`)

const typeOfName: Record<string, ImageType> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' }

/** A path a theme may write (ARCHITECTURE §3.4 "Files"). */
export const isThemePath = (path: string) => codePath.test(path) || cssPath.test(path) || path === themeCssPath || contentPath.test(path) || path === routesPath || mediaPath.test(path)

const allowedMessage =
  'A theme may write only src/theme/pages/**/*.tsx, src/theme/components/**/*.tsx, src/theme/styles/**/*.module.css, src/theme/styles/theme.css, src/theme/media/*.{png,jpg,jpeg,webp}, content/{language}/*.json and routes.json.'

const lockedMessage = (path: string) =>
  path.startsWith('.github/') ? `${path} is the locked build workflow, which only the platform writes. ${allowedMessage}` : `${path} is outside the theme. ${allowedMessage}`

const bytes = (text: string) => new TextEncoder().encode(text).byteLength
const megabytes = (n: number) => `${n / (1024 * 1024)} MB`

/** Why a path under src/theme/media/ isn't one an image may have. */
const mediaPathProblem = (path: string): Problem =>
  /\.(?:png|jpe?g|webp)$/i.test(path) && !path.slice(mediaFolder.length).includes('/')
    ? problem(path, null, 'files/media-name-not-allowed', 'An image name is plain letters, digits, - and _ (up to 64), with a lower-case .png, .jpg, .jpeg or .webp, directly in src/theme/media/.')
    : problem(path, null, 'files/media-type-not-allowed', 'src/theme/media/ holds only PNG, JPEG and WebP images, directly in the folder: no SVG, no video, no subfolders.')

/** One image's bytes against its name and the caps; its size in bytes when it passes. */
const checkImage = (f: ThemeFile, problems: Problem[]): number | null => {
  const data = f.encoding === 'base64' ? fromBase64(f.content) : null
  if (!data) {
    problems.push(problem(f.path, null, 'files/encoding', 'An image must reach the validator as base64.'))
    return null
  }
  if (data.byteLength > maxMediaBytes) {
    problems.push(problem(f.path, null, 'files/media-too-large', `This image is ${data.byteLength} bytes; an image may be at most ${megabytes(maxMediaBytes)}.`))
    return null
  }
  const read = readImage(data)
  const named = typeOfName[f.path.slice(f.path.lastIndexOf('.') + 1)]
  if (!read.ok && read.reason === 'not-image') problems.push(problem(f.path, null, 'files/media-type-mismatch', 'This file isn\'t a PNG, JPEG or WebP image, whatever its name says.'))
  else if (!read.ok && read.reason === 'dimensions') problems.push(problem(f.path, null, 'files/media-dimensions', `An image is 1 to ${maxImageSide} pixels on each side.`))
  else if (!read.ok) problems.push(problem(f.path, null, 'files/media-unreadable', "This image can't be read: it is cut short or damaged. Export it again."))
  else if (read.type !== named) problems.push(problem(f.path, null, 'files/media-type-mismatch', `This file is a ${read.type.toUpperCase()} image; name it with that type's extension.`))
  else return data.byteLength
  return null
}

/** The file allowlist and the size caps (ARCHITECTURE §3.4 "Files"); the text files that passed by path, and the images by name. */
export const checkFiles = (input: readonly ThemeFile[], context: GuardContext): { problems: Problem[]; files: Map<string, string>; media: Set<string> } => {
  const problems: Problem[] = []
  const isMedia = (f: ThemeFile) => f.path.startsWith(mediaFolder)
  const text = input.filter((f) => !isMedia(f))
  if (text.length > maxFiles) problems.push(problem(null, null, 'files/too-many-files', `The theme would have ${text.length} files; it may have at most ${maxFiles}.`))
  const total = text.reduce((sum, f) => sum + bytes(f.content), 0)
  if (total > maxThemeBytes) problems.push(problem(null, null, 'files/theme-too-large', `The theme would be ${total} bytes; it may be at most ${maxThemeBytes}.`))
  const images = input.length - text.length
  if (images > maxMediaFiles) problems.push(problem(null, null, 'files/too-many-media', `The theme would have ${images} images; it may have at most ${maxMediaFiles}.`))

  const files = new Map<string, string>()
  const media = new Set<string>()
  let mediaBytes = 0
  // Two names a case-insensitive disk folds together would be one file there.
  const seen = new Set<string>()
  for (const f of input) {
    const folded = f.path.toLowerCase()
    if (seen.has(folded)) {
      problems.push(problem(f.path, null, 'files/duplicate-path', 'Another file in the change has this path, or one that differs only in case.'))
      continue
    }
    seen.add(folded)
    if (!isThemePath(f.path)) {
      problems.push(isMedia(f) ? mediaPathProblem(f.path) : problem(f.path, null, 'files/path-not-allowed', lockedMessage(f.path)))
      continue
    }
    if (f.symlink) {
      problems.push(problem(f.path, null, 'files/symlink', 'A theme file must be a plain file, never a link to another one.'))
      continue
    }
    if (isMedia(f)) {
      const size = checkImage(f, problems)
      if (size !== null) {
        mediaBytes += size
        media.add(f.path.slice(mediaFolder.length))
      }
      continue
    }
    if (f.encoding !== undefined) {
      problems.push(problem(f.path, null, 'files/encoding', 'Only an image in src/theme/media/ comes as base64; this file is text.'))
      continue
    }
    const locale = contentPath.exec(f.path)?.[1]
    if (locale !== undefined && !context.locales.includes(locale)) {
      problems.push(problem(f.path, null, 'files/locale-not-offered', `The store doesn't offer "${locale}"; write words only for ${context.locales.join(', ')}.`))
      continue
    }
    const size = bytes(f.content)
    if (size > maxFileBytes) {
      problems.push(problem(f.path, null, 'files/file-too-large', `This file is ${size} bytes; a theme file may be at most ${maxFileBytes}.`))
      continue
    }
    files.set(f.path, f.content)
  }
  if (mediaBytes > maxMediaTotalBytes) problems.push(problem(null, null, 'files/media-total-too-large', `The theme's images would be ${mediaBytes} bytes; they may be at most ${megabytes(maxMediaTotalBytes)} in all.`))
  return { problems, files, media }
}
