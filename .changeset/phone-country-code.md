---
'@dripfunnel/storefront-core': minor
---

Adds `PhoneField`: a country code dropdown and the number, handed back as E.164 with no spaces (`+919876543210`), the form every Shop API phone input checks. `AddressFields` and the baseline checkout use it; a theme's own contact or sign-in phone field may switch from `TextField` to `PhoneField` (it needs `codeLabel`, `country` and `locale`). The phone error now reads "Check the country code and the number."
