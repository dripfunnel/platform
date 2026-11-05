---
'@dripfunnel/storefront-core': minor
---

`<RichText html className>` shows a product's description with its paragraphs, bold and italic text, lists and links, and a theme places it where it printed `product.description` before; the description now carries the engine's formatting as HTML, which a `<p>` would show as text. `textOfRichText` gives the same words as plain text, and core's `<head>` and structured data use it for a product with no search description of its own.
