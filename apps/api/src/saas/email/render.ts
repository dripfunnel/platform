// One layout for every email: plain text plus a simple HTML version that mail clients render
// alike. Every value is escaped; nothing from a payload reaches the HTML unescaped.

export interface Brand {
  /** The name readers know: the partner's product name, or DripFunnel. */
  name: string
  primary: string
  accent: string
  supportEmail: string | null
  supportUrl: string | null
  poweredBy: boolean
}

export interface EmailContent {
  subject: string
  heading: string
  paragraphs: readonly string[]
  action?: { label: string; url: string }
  /** Small print under the action, e.g. how long a link works. */
  note?: string
}

export interface FooterWords {
  support: (contact: string) => string
  poweredBy: string
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const hexColor = /^#[0-9a-fA-F]{6}$/

// WCAG relative luminance, to pick black or white text on the partner's own colour.
const textOn = (background: string) => {
  const channel = (i: number) => {
    const c = parseInt(background.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return luminance > 0.179 ? '#14181f' : '#ffffff'
}

const supportContact = (brand: Brand) => brand.supportEmail ?? brand.supportUrl

export const renderEmail = (brand: Brand, content: EmailContent, words: FooterWords): { subject: string; text: string; html: string } => {
  const primary = hexColor.test(brand.primary) ? brand.primary : '#0a2a4a'
  const accent = hexColor.test(brand.accent) ? brand.accent : primary
  const contact = supportContact(brand)
  const footer = [contact ? words.support(contact) : null, brand.poweredBy ? words.poweredBy : null].filter((line): line is string => line !== null)

  const text = [
    brand.name,
    '',
    content.heading,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.action ? [`${content.action.label}: ${content.action.url}`, ''] : []),
    ...(content.note ? [content.note, ''] : []),
    ...(footer.length > 0 ? ['--', ...footer] : []),
  ].join('\n')

  const cell = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px">
<tr><td style="${cell}padding:20px 28px;border-bottom:3px solid ${primary};font-size:18px;font-weight:700;color:${primary}">${escapeHtml(brand.name)}</td></tr>
<tr><td style="${cell}padding:24px 28px 8px;font-size:20px;font-weight:700;color:#14181f">${escapeHtml(content.heading)}</td></tr>
${content.paragraphs.map((p) => `<tr><td style="${cell}padding:8px 28px;font-size:15px;line-height:1.5;color:#14181f">${escapeHtml(p)}</td></tr>`).join('\n')}
${
  content.action
    ? `<tr><td style="${cell}padding:16px 28px"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${accent};color:${textOn(accent)};font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(content.action.label)}</a></td></tr>
<tr><td style="${cell}padding:0 28px 8px;font-size:13px;line-height:1.5;color:#5a6472;word-break:break-all">${escapeHtml(content.action.url)}</td></tr>`
    : ''
}
${content.note ? `<tr><td style="${cell}padding:8px 28px;font-size:13px;line-height:1.5;color:#5a6472">${escapeHtml(content.note)}</td></tr>` : ''}
<tr><td style="${cell}padding:20px 28px 24px;font-size:12px;line-height:1.5;color:#5a6472">${footer.map(escapeHtml).join('<br>')}</td></tr>
</table></td></tr></table>
</body></html>`

  return { subject: content.subject, text, html }
}
