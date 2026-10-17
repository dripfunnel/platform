---
'@dripfunnel/storefront-core': patch
---
The phone check on checkout and on the account address form now matches the API's (a number with its country code, such as +919876543210), so a number the API would refuse is flagged on the form instead of failing the order. Spaces, dashes, dots and brackets are accepted and removed before the number is sent. The message tells the shopper to start with the country code.
