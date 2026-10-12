import { z } from 'zod'
import type { AiImage, AiProvider } from '#integrations/ai/index'
import type { DesignModel, Proposal } from '#saas/studio/index'

// The Worker's side of one change (storefront ARCHITECTURE §6.2; AI-STUDIO §4 step 2): the model gets the theme, the
// rules and the merchant's context, and answers with a file diff that is only data until the fast gate passes it.

export type Device = 'desktop' | 'tablet' | 'phone'

export interface DesignBrief {
  page: string
  device: Device
  /** The merchant's last four requests, oldest first. */
  recent: string[]
  store: { name: string; city: string | null; languages: string[] }
  brand: { tagline: string | null; description: string | null; voice: string | null; colours: string[] }
  /** About twelve products, names and prices only, never photos (SAAS §9.2). */
  products: { name: string; price: string | null }[]
  /** The merchant's pasted image and the sample site's screenshot, each the platform's own copy. */
  image: AiImage | null
  screenshot: AiImage | null
}

const answerSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1).max(512), content: z.string().max(1024 * 1024).nullable() })).max(200),
  reply: z.string().max(2000),
  changed: z.array(z.string().max(80)).max(5),
  page: z.string().max(200).nullable(),
})

const rules = `You design one online shop's storefront theme for DripFunnel. The shop's commerce (prices, stock, products,
discounts, shipping, tax, checkout, payments, accounts) belongs to the platform; you change only how the shop looks and
reads, by editing its theme files.
- Write only src/theme/**, content/{language}/**.json and routes.json. Everything else is locked.
- Use only @dripfunnel/storefront-core's theme API, React and CSS modules. No network calls, fetch, third-party scripts,
  external fonts or images by address, eval, inline event handlers or new dependencies.
- Never invent data: no hard-coded products, prices, stock, discounts, ratings, reviews, badges or scarcity claims.
- Sealed components (the price with its tax label, the payment element, legal and consent notices, the preview banner,
  the "Powered by" line, breadcrumbs, the order summary) are placed and styled, never removed, covered or reworded.
- Words live in content/{language}/*.json: write every language the shop offers, with the same keys in each.
- Custom pages are listed in routes.json under "custom"; core's routes are reserved.
- From a sample site take layout, spacing, colour and mood, never its logo, photos or words. Brand colours are a hint.
- If asked to change prices, stock, products, shipping or checkout, change no file and say that is done in Products or
  Settings. If a request would make pages slow or break a rule, change nothing and offer an alternative in words.
- Keep everything not asked for exactly as it is.
Answer with only one JSON object and nothing else:
{"files":[{"path":"…","content":"the whole new file, or null to delete it"}],"reply":"one or two short first-person
sentences in plain words saying what you changed","changed":["2 to 5 short labels"],"page":"the page to show, or null"}`

const briefText = (brief: DesignBrief, request: string, theme: readonly { path: string; content: string }[], problems: readonly { file: string | null; line: number | null; rule: string; message: string }[]) =>
  [
    `The merchant is looking at the ${brief.page} page on ${brief.device}.`,
    `Shop: ${JSON.stringify(brief.store)}`,
    `Brand: ${JSON.stringify(brief.brand)}`,
    `Products (sample): ${JSON.stringify(brief.products)}`,
    brief.recent.length > 0 ? `Earlier requests:\n${brief.recent.map((r) => `- ${r}`).join('\n')}` : '',
    brief.image ? 'The first image is one the merchant attached.' : '',
    brief.screenshot ? 'The last image is a screenshot of a site the merchant gave as inspiration.' : '',
    `The theme now:\n${theme.map((f) => `--- ${f.path}\n${f.content}`).join('\n')}`,
    problems.length > 0 ? `Your last answer failed these checks; fix them and answer again with every file it needs:\n${problems.map((p) => `- ${p.file ?? ''}${p.line ? `:${p.line}` : ''} ${p.rule}: ${p.message}`).join('\n')}` : '',
    `The merchant asks: ${request}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n')

/** The JSON object in the model's text, if it is one in the shape asked for. */
export const readAnswer = (text: string): z.infer<typeof answerSchema> | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = answerSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The studio's model for one request: each ask (and each repair) is one call with the same brief. */
export const designModel = (provider: AiProvider, brief: DesignBrief): DesignModel => ({
  propose: async (input): Promise<Proposal> => {
    const images = [brief.image, brief.screenshot].filter((i) => i !== null)
    const answer = await provider.complete({ system: rules, text: briefText(brief, input.request, input.theme, input.problems), images })
    const read = readAnswer(answer.text)
    const cost = { model: answer.model, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut, costAmount: answer.costAmount, costCurrency: answer.costCurrency }
    // An answer in no usable shape changes nothing; the reply says so (FIRST-RELEASE §14's error).
    if (!read) return { files: [], summary: null, ...cost }
    return { files: read.files, summary: { reply: read.reply, changed: read.changed, page: read.page }, ...cost }
  },
})
