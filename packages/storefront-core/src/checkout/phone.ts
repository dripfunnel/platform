import { compact } from './address'

// ITU-T E.164 calling codes; where several countries share one, the first is the one a number defaults to.
const byCode = '1:US,CA,AG,AI,AS,BB,BM,BS,DM,DO,GD,GU,JM,KN,KY,LC,MP,MS,PR,SX,TC,TT,VC,VG,VI 7:RU,KZ 20:EG 27:ZA 30:GR 31:NL 32:BE 33:FR 34:ES 36:HU 39:IT,VA 40:RO 41:CH 43:AT 44:GB,GG,IM,JE 45:DK 46:SE 47:NO,SJ 48:PL 49:DE 51:PE 52:MX 53:CU 54:AR 55:BR 56:CL 57:CO 58:VE 60:MY 61:AU,CC,CX 62:ID 63:PH 64:NZ 65:SG 66:TH 81:JP 82:KR 84:VN 86:CN 90:TR 91:IN 92:PK 93:AF 94:LK 95:MM 98:IR 211:SS 212:MA,EH 213:DZ 216:TN 218:LY 220:GM 221:SN 222:MR 223:ML 224:GN 225:CI 226:BF 227:NE 228:TG 229:BJ 230:MU 231:LR 232:SL 233:GH 234:NG 235:TD 236:CF 237:CM 238:CV 239:ST 240:GQ 241:GA 242:CG 243:CD 244:AO 245:GW 246:IO 248:SC 249:SD 250:RW 251:ET 252:SO 253:DJ 254:KE 255:TZ 256:UG 257:BI 258:MZ 260:ZM 261:MG 262:RE,YT 263:ZW 264:NA 265:MW 266:LS 267:BW 268:SZ 269:KM 290:SH 291:ER 297:AW 298:FO 299:GL 350:GI 351:PT 352:LU 353:IE 354:IS 355:AL 356:MT 357:CY 358:FI,AX 359:BG 370:LT 371:LV 372:EE 373:MD 374:AM 375:BY 376:AD 377:MC 378:SM 380:UA 381:RS 382:ME 383:XK 385:HR 386:SI 387:BA 389:MK 420:CZ 421:SK 423:LI 500:FK 501:BZ 502:GT 503:SV 504:HN 505:NI 506:CR 507:PA 508:PM 509:HT 590:GP,BL,MF 591:BO 592:GY 593:EC 594:GF 595:PY 596:MQ 597:SR 598:UY 599:CW,BQ 670:TL 672:NF 673:BN 674:NR 675:PG 676:TO 677:SB 678:VU 679:FJ 680:PW 681:WF 682:CK 683:NU 685:WS 686:KI 687:NC 688:TV 689:PF 690:TK 691:FM 692:MH 850:KP 852:HK 853:MO 855:KH 856:LA 880:BD 886:TW 960:MV 961:LB 962:JO 963:SY 964:IQ 965:KW 966:SA 967:YE 968:OM 970:PS 971:AE 972:IL 973:BH 974:QA 975:BT 976:MN 977:NP 992:TJ 993:TM 994:AZ 995:GE 996:KG 998:UZ'

// Caribbean members of +1 dial their area code as part of the country's code (+1 876 for Jamaica).
const areaCodes: Readonly<Record<string, string>> = { AG: '268', AI: '264', AS: '684', BB: '246', BM: '441', BS: '242', DM: '767', DO: '809', GD: '473', GU: '671', JM: '876', KN: '869', KY: '345', LC: '758', MP: '670', MS: '664', PR: '787', SX: '721', TC: '649', TT: '868', VC: '784', VG: '284', VI: '340' }

/** Every country a mobile number can start with, by ISO 3166 code, with its calling code's digits. */
export const callingCodes: readonly { country: string; dial: string }[] = byCode.split(' ').flatMap((group) => {
  const [dial = '', countries = ''] = group.split(':')
  return countries.split(',').map((country) => ({ country, dial: dial + (areaCodes[country] ?? '') }))
})

export const dialOf = (country: string): string | null => callingCodes.find((c) => c.country === country)?.dial ?? null

const sorted = new Map<string, readonly { country: string; dial: string; name: string }[]>()

/** The countries by name in the shopper's language, worked out once per language. */
export const countryOptions = (locale: string) => {
  const known = sorted.get(locale)
  if (known) return known
  const names = new Intl.DisplayNames([locale], { type: 'region' })
  const options = callingCodes.map((c) => ({ ...c, name: names.of(c.country) ?? c.country })).sort((a, b) => a.name.localeCompare(b.name, locale))
  sorted.set(locale, options)
  return options
}

/**
 * A number split into its country and the rest. The longest calling code that fits wins; `preferred` breaks a tie (+1
 * is the US unless the shopper chose Canada) and is the country of a number not yet started with `+`.
 */
export const splitPhone = (value: string, preferred: string): { country: string; national: string } => {
  const number = compact(value)
  const fits = number.startsWith('+') ? callingCodes.filter((c) => number.startsWith(`+${c.dial}`)) : []
  if (fits.length === 0) return { country: number.startsWith('+') || !dialOf(preferred) ? '' : preferred, national: number }
  const longest = Math.max(...fits.map((c) => c.dial.length))
  const best = fits.filter((c) => c.dial.length === longest)
  return { country: best.find((c) => c.country === preferred)?.country ?? best[0]?.country ?? '', national: number.slice(1 + longest) }
}

/** The number as the API takes it (E.164, no spaces): `+`, the calling code and the rest; empty while nothing is typed. */
export const joinPhone = (country: string, national: string): string => {
  // A pasted whole number keeps its own code, written with `+` or the international 00.
  const typed = compact(national).replace(/^00/, '+')
  const dial = dialOf(country)
  return typed === '' || typed.startsWith('+') || !dial ? typed : `+${dial}${typed}`
}
