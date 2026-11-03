// Real exports from a Shopify store with two locations (#1178): Admin › Products › Export, and
// Products › Inventory › Export. The products file has no `Variant Inventory Qty` column, as Shopify writes it
// for a store with more than one location; the inventory file names a product the products file doesn't have.

export const shopifyProductsCsv = [
  'Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Option1 Linked To,Option2 Name,Option2 Value,Option2 Linked To,Option3 Name,Option3 Value,Option3 Linked To,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Policy,Variant Fulfillment Service,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Unit Price Total Measure,Unit Price Total Measure Unit,Unit Price Base Measure,Unit Price Base Measure Unit,Variant Barcodes,Image Src,Image Position,Image Alt Text,Gift Card,SEO Title,SEO Description,Chocolate type (product.metafields.shopify.chocolate-type),Coffee product form (product.metafields.shopify.coffee-product-form),Flavor (product.metafields.shopify.flavor),Grind size (product.metafields.shopify.grind-size),Variant Image,Variant Weight Unit,Variant Tax Code,Cost per item,Status,Variant Packed Length,Variant Packed Width,Variant Packed Height,Variant Packed Dimension Unit',
  'everyday-chocolate-bar-100-g,Everyday Chocolate Bar – 100 g,"<p>Take a little time for chocolate. Break off a piece to enjoy with your afternoon coffee, share a bar with a friend, or save some for an after-dinner treat.</p><ul>',
  '<li>Format: Chocolate bar</li>',
  '<li>Pack size: 100 g</li>',
  '<li>Store in a cool, dry place away from direct sunlight.</li>',
  '</ul>",My Store,"Food, Beverages & Tobacco > Food Items > Candy & Chocolate > Chocolate > Chocolate Bars & Tablets",Chocolate,"",true,Title,Default Title,,,,,,,,,0.0,shopify,deny,manual,199.00,,true,true,,,,,"",https://cdn.shopify.com/s/files/1/0973/5598/9289/files/jessica-loaiza-jxfByDVJmS4-unsplash_80fa1d8c-0b9e-409e-8c33-49a924470be5.jpg?v=1793622478,1,"",false,Chocolate Bar – 100 g | Everyday Chocolate,"Make time for a sweet break with an Everyday Chocolate Bar, 100 g. Enjoy with coffee, share with a friend, or save for an after-dinner treat.",dark-chocolate,,chocolate,,,kg,,,active,,,,',
  'everyday-ground-coffee-250-g,Everyday Ground Coffee – 250 g,"<p>Make time for your daily coffee ritual, from the first warm cup of the morning to a relaxed afternoon break.</p><p>Brew a cup, add milk or enjoy it black, and make the moment your own.</p><ul>',
  '<li>Format: Ground coffee</li>',
  '<li>Pack size: 250 g</li>',
  '<li>Storage: Keep tightly sealed in a cool, dry place away from sunlight.</li>',
  '</ul>",My Store,"Food, Beverages & Tobacco > Beverages > Coffee > Coffee Beans & Ground Coffee",Coffee,"",true,Title,Default Title,,,,,,,,,0.0,shopify,deny,manual,399.00,,true,true,,,,,"",https://cdn.shopify.com/s/files/1/0973/5598/9289/files/pablo-merchan-montes-SCbq6uKCyMY-unsplash.jpg?v=1793621560,1,"",false,Everyday Ground Coffee – 250 g,Bring coffee into your everyday ritual with a 250 g pack of ground coffee. Enjoy your cup black or with milk.,,ground,coffee,medium,,kg,,,active,,,,',
].join('\n')

export const shopifyInventoryCsv = [
  'Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,SKU,HS Code,COO,Location,Bin name,Incoming (not editable),Unavailable (not editable),Committed (not editable),Available (not editable),On hand (current),On hand (new),Variant Packed Length,Variant Packed Width,Variant Packed Height,Variant Packed Dimension Unit',
  'everyday-ground-coffee-250-g,Everyday Ground Coffee – 250 g,Title,Default Title,,,,,"",,,"#9,Matha pitru nivasa",,0,0,0,20,20,,,,,',
  'everyday-ground-coffee-250-g,Everyday Ground Coffee – 250 g,Title,Default Title,,,,,"",,,Indiranagar,,0,0,0,40,40,,,,,',
  'everyday-chocolate-bar-100-g,Everyday Chocolate Bar – 100 g,Title,Default Title,,,,,"",,,"#9,Matha pitru nivasa",,0,0,0,40,40,,,,,',
  'everyday-chocolate-bar-100-g,Everyday Chocolate Bar – 100 g,Title,Default Title,,,,,"",,,Indiranagar,,0,0,0,80,80,,,,,',
  'everyday-dark-chocolate-bar-100-g,Everyday Dark Chocolate Bar – 100 g,Title,Default Title,,,,,"",,,"#9,Matha pitru nivasa",,0,0,0,59,59,,,,,',
  'everyday-dark-chocolate-bar-100-g,Everyday Dark Chocolate Bar – 100 g,Title,Default Title,,,,,"",,,Indiranagar,,not stocked,not stocked,not stocked,not stocked,not stocked,,,,,',
].join('\n')

/** Shopify's own shape for a product with three options, several photos out of order, a draft, and a quantity column (single location). */
export const shopifyVariantsCsv = [
  'Handle,Title,Body (HTML),Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Price,Variant Compare At Price,Variant Barcode,Image Src,Image Position,Image Alt Text,SEO Title,SEO Description,Cost per item,Status',
  'ribbed-tee,Ribbed tee,<p>Soft &amp; light</p>,Size,S,Color,Red,Fabric,Cotton,TEE-S-R,180.0,5,499.00,599.00,4006381333931,https://cdn.example/tee-1.png,1,Front,Tee | Shop,A soft tee,210.00,active',
  'ribbed-tee,,,,M,,Red,,Cotton,TEE-M-R,190.0,2,499.00,599.00,,https://cdn.example/tee-3.png,3,Side,,,,',
  'ribbed-tee,,,,,,,,,,,,,,,https://cdn.example/tee-2.png,2,Back,,,,',
  'sketch,Sketch,<p>Not live yet</p>,Title,Default Title,,,,,SKETCH,0.0,,150.00,,,,,,,,,draft',
].join('\n')
