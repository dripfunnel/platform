// The smallest well-formed PNG, JPEG and WebP files the validator's structural read accepts (guard/media.ts).

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff]
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

const crc32 = (bytes: readonly number[]) => {
  let c = 0xffffffff
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: readonly number[]) => [...be32(data.length), ...ascii(type), ...data, ...be32(crc32([...ascii(type), ...data]))]

export const png = (width = 4, height = 3, idat: readonly number[] = [0x78, 0x9c, 0x63, 0x00, 0x00]): Uint8Array =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(width), ...be32(height), 8, 2, 0, 0, 0]),
    ...chunk('IDAT', idat),
    ...chunk('IEND', []),
  ])

export const jpeg = (width = 4, height = 3): Uint8Array =>
  new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0,
    0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56,
    0xff, 0xd9,
  ])

export const webp = (width = 4, height = 3): Uint8Array => {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  const vp8l = [...ascii('VP8L'), ...le32(5), 0x2f, ...le32(bits), 0]
  return new Uint8Array([...ascii('RIFF'), ...le32(4 + vp8l.length), ...ascii('WEBP'), ...vp8l])
}

export const base64 = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
