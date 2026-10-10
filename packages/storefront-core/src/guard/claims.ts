import type { RuleId } from './rules'

// Invented data the theme's words may not claim (ARCHITECTURE §3.3, DESIGN §3), in English and Hindi, digits in any script.
const d = '\\p{Nd}'
const amount = `${d}[${d},.]*`
const few = `(?:${d}+|one|two|three|four|five|six|seven|eight|nine|ten|a\\s+few|few|a\\s+handful|last\\s+few)`
const five = `(?:5|10|५|१०)`
const currencyCodes = 'rs|inr|usd|eur|gbp|aed|aud|cad|sgd|jpy|chf|nzd|sar|myr|zar'
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'iu')
const plain = (source: string) => new RegExp(source, 'iu')

type Claim = { rule: RuleId; what: string; patterns: readonly RegExp[] }

const claims: readonly Claim[] = [
  {
    rule: 'content/price',
    what: 'a price or a discount',
    patterns: [
      plain(`\\p{Sc}\\s?${d}|${d}\\s?\\p{Sc}|${d}\\s?\\/-`),
      word(`(?:${currencyCodes}|mrp)\\.?\\s?:?\\s?${amount}|${amount}\\s?(?:${currencyCodes}|rupees?|dollars?|euros?|pounds?|dirhams?)`),
      word(`${d}+\\s?(?:%|percent|per\\s+cent)\\s?(?:off|discount)|(?:save|get)\\s+(?:up\\s+to\\s+)?${d}+\\s?(?:%|percent)|flat\\s+${d}+\\s?(?:%\\s?)?off|half\\s+price|buy\\s+(?:one|1)\\s+get\\s+(?:one|1)|bogo`),
      plain(`रु\\.?\\s?${d}|${d}\\s?(?:रुपये|रुपए|रु)(?![\\p{L}\\p{M}])|${d}+\\s?%\\s?(?:की\\s)?छूट`),
    ],
  },
  {
    rule: 'content/scarcity',
    what: 'a claim about stock or demand',
    patterns: [
      word(`(?:only|just)\\s+${few}\\s+(?:left|remaining|available|in\\s+stock)|${few}\\s+(?:left|remaining)|${d}+\\s+in\\s+stock`),
      word('selling\\s+fast|almost\\s+gone|nearly\\s+gone|limited\\s+stock|low\\s+(?:in\\s+)?stock|while\\s+(?:stocks?|supplies)\\s+last|in\\s+high\\s+demand|best\\s?-?sellers?|most\\s+popular|trending\\s+now|sells?\\s+out\\s+(?:soon|fast)'),
      word(`${d}+\\s+(?:people|shoppers|customers)\\s+(?:are\\s+)?(?:viewing|looking|watching|bought|have\\s+bought)`),
      plain('(?:केवल|सिर्फ|बस)\\s*\\p{Nd}+\\s*(?:बचे|बची|बाकी)|तेज़?ी\\s*से\\s*बिक|सीमित\\s*स्टॉक|स्टॉक\\s*सीमित|बेस्ट\\s*सेलर'),
    ],
  },
  {
    rule: 'content/urgency',
    what: 'a claim of urgency',
    patterns: [
      word("hurry|last\\s+chance|today\\s+only|limited\\s+time|ends?\\s+soon|ending\\s+soon|don'?t\\s+miss\\s+out|act\\s+(?:now|fast)|before\\s+it'?s\\s+gone|now\\s+or\\s+never"),
      plain('जल्दी\\s*(?:करें|कीजिए|करो)|(?:आखिरी|अंतिम)\\s*मौका|सीमित\\s*समय|आज\\s*ही\\s*(?:खरीदें|ख़रीदें|ऑर्डर)'),
    ],
  },
  {
    rule: 'content/rating',
    what: 'a rating or a review count',
    patterns: [
      /[★☆⭐✩✪✫✬✭✮✯✰]/u,
      plain(`(?<![\\p{L}\\p{N}/.,])${d}(?:[.,]${d})?\\s*(?:\\/|out\\s+of)\\s*${five}(?![\\p{N}/])`),
      word(`${d}(?:[.,]${d})?\\s*(?:stars?|rating)|rated\\s+(?:${d}|one|two|three|four|five)|(?:one|two|three|four|five)\\s+stars?|${d}[${d},]*\\+?\\s+(?:happy\\s+|verified\\s+|customer\\s+)?(?:reviews?|ratings?|customers)`),
      plain(`${d}(?:[.,]${d})?\\s*में\\s*से\\s*${five}|${five}\\s*में\\s*से\\s*${d}|${d}(?:[.,]${d})?\\s*स्टार|${d}[${d},]*\\s*(?:रिव्यू|समीक्षाएं|समीक्षा|रेटिंग)`),
    ],
  },
  {
    rule: 'content/countdown',
    what: 'a countdown',
    patterns: [
      word(`${d}{1,2}:${d}{2}:${d}{2}|count\\s?down|(?:ends|ending|expires|expiring)\\s+(?:in\\s+${d}|tonight|today|tomorrow|at\\s+midnight)`),
      word(`${d}+\\s*(?:hours?|hrs?|minutes?|mins?|days?|seconds?|secs?|h|m|d|s)\\s*(?:${d}+\\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|h|m|s)\\s*)*(?:left|to\\s+go|remaining)`),
      plain(`${d}+\\s*(?:घंटे|मिनट|दिन)\\s*(?:बाकी|शेष)|${d}+\\s*(?:घंटे|मिनट|दिन)\\s*में\\s*(?:समाप्त|खत्म)`),
    ],
  },
]

// Letters from other scripts that look Latin, so "оnly 3 lеft" in Cyrillic letters reads as English.
const lookAlikes: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ӏ: 'l', ν: 'v',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', І: 'I',
  α: 'a', ε: 'e', ο: 'o', ρ: 'p', τ: 't', υ: 'u', ι: 'i', κ: 'k', Ο: 'O', Α: 'A', Ε: 'E', Τ: 'T',
}

// Format characters and accents, but not Devanagari's vowel signs, which carry Hindi's meaning.
const hidden = new RegExp('\\p{Cf}|[\\p{Mn}--[\\u0900-\\u097F]]', 'gv')

/** Text as a shopper reads it: compatibility forms and accents folded, invisible characters dropped, look-alike letters made Latin. */
export const asRead = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(hidden, '')
    .normalize('NFC')
    .replace(/\p{Zs}+/gu, ' ')
    .replace(/./gu, (c) => lookAlikes[c] ?? c)

/** Each kind of invented claim a piece of the theme's words makes. */
export const claimsIn = (text: string): { rule: RuleId; what: string }[] => {
  const read = asRead(text)
  return claims.filter((c) => c.patterns.some((p) => p.test(read))).map(({ rule, what }) => ({ rule, what }))
}
