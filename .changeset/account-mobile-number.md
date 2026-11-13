---
'@dripfunnel/storefront-core': minor
---

A signed-in shopper can add or change their mobile number on Account › Your details, proved by a text code at the new number (#1404). `useAccount()` gains `phoneAllowed` (the shop signs in by mobile), `phoneCodeFor` (the number a code was sent to), `sendPhoneCode(to)`, `confirmPhone(code)` and `cancelPhone()`; a refusal shows as `error` with `of: 'phone'` (`CODE_REFUSED`, `RATE_LIMITED`, `METHOD_OFF`, …). The account keeps its old number until the code is proved, and a number another account holds is refused as a wrong code is. The baseline and Classic themes draw the control; a theme that doesn't keeps showing the number it has, and nothing breaks.
