---
'@dripfunnel/storefront-core': patch
---

The checkout's **Phone for delivery** is required (#1584). It no longer says "Optional"; leaving it empty stops **Continue** on the field with "Add a phone number for delivery." (`address.phoneRequired`), and the field takes focus. A wrong number still shows "Check the country code and the number." A saved address without a phone asks for one before checkout goes on. The Shop API refuses a delivery address without a phone too. Themes need no change.
